/**
 * The live mail session.
 *
 * Owns two IMAP connections on purpose:
 *   - `syncClient` opens and closes mailboxes as it syncs headers and fetches
 *     bodies on demand.
 *   - `idleClient` keeps INBOX open and sits in IDLE so new mail is noticed
 *     within seconds.
 *
 * One connection cannot do both: imapflow serialises commands behind a mailbox
 * lock, so a body fetch would repeatedly drop out of IDLE and new mail would
 * arrive late or not at all.
 */

import type { Database } from 'better-sqlite3';
import type { ImapFlow } from 'imapflow';
import type { FolderRole, SyncStatus } from '../types/mail.js';
import type { MailProvider } from '../providers/types.js';
import { getProvider } from '../providers/index.js';
import { loadConfig } from '../config/index.js';
import { bus } from '../events.js';
import { getAppPassword } from '../secrets/keychain.js';
import * as accountsStore from '../store/accounts.js';
import * as foldersStore from '../store/folders.js';
import * as messagesStore from '../store/messages.js';
import { createClient, describeImapError } from './client.js';
import { discoverFolders } from './discover.js';
import { fetchAndStoreBody, type ParsedBody } from './bodies.js';
import { syncAll, syncFolder, type SyncContext } from './sync.js';

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60_000;

export class MailSession {
  private syncClient: ImapFlow | null = null;
  private idleClient: ImapFlow | null = null;
  private provider: MailProvider | null = null;
  private accountId: number | null = null;
  private accountEmail: string | null = null;

  private isSyncing = false;
  private lastError: string | null = null;
  private stopped = true;
  private reconnectAttempts = 0;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private pendingSync: Promise<void> | null = null;

  constructor(private readonly db: Database) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Bring the session up for the stored account.
   *
   * Resolves once connected and the first sync has been kicked off; the sync
   * itself continues in the background so pairing feels immediate.
   */
  async start(): Promise<void> {
    const account = accountsStore.getAccount(this.db);
    if (!account) return; // Not paired yet — nothing to do.

    const appPassword = getAppPassword(account.email);
    if (!appPassword) {
      this.lastError = 'No app password found in the keychain for this account. Re-pair DayDesk.';
      return;
    }

    this.stopped = false;
    this.accountId = account.id;
    this.accountEmail = account.email;
    this.provider = getProvider(account.provider_id);

    const options = { provider: this.provider, email: account.email, appPassword };

    this.syncClient = createClient(options);
    this.idleClient = createClient(options);

    try {
      await Promise.all([this.syncClient.connect(), this.idleClient.connect()]);
      this.lastError = null;
      this.reconnectAttempts = 0;

      await this.ensureFoldersDiscovered();
      this.attachErrorHandlers();
      void this.runSync(() => syncAll(this.context()));
      await this.startIdle();
      this.startReconcileTimer();
    } catch (error) {
      this.lastError = describeImapError(error);
      this.scheduleReconnect();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;

    for (const client of [this.idleClient, this.syncClient]) {
      try {
        if (client?.usable) await client.logout();
      } catch {
        client?.close();
      }
    }
    this.syncClient = null;
    this.idleClient = null;
  }

  // ── Public operations ─────────────────────────────────────────────────────

  getStatus(): SyncStatus {
    const account = accountsStore.getAccount(this.db);
    const folders = account ? foldersStore.listFolders(this.db, account.id) : [];

    return {
      accountEmail: account?.email ?? null,
      isPaired: account !== null,
      isConnected: this.syncClient?.usable === true,
      isSyncing: this.isSyncing,
      lastError: this.lastError,
      folders: folders.map((folder) => ({
        role: folder.role,
        path: folder.path,
        messageCount: messagesStore.countMessages(this.db, folder.id),
        floorUid: folder.floor_uid,
        floorDate: folder.floor_date,
        lastSyncAt: folder.last_sync_at,
      })),
    };
  }

  /** Request a sync. Coalesces with any pass already running. */
  async requestSync(role?: FolderRole): Promise<void> {
    if (!this.syncClient?.usable) throw new Error('Not connected to Yahoo.');
    await this.runSync(() => (role ? syncFolder(this.context(), role) : syncAll(this.context())));
  }

  /** Fetch a body on demand, caching it. Returns null if the message is gone. */
  async loadBody(messageRowId: number, role: FolderRole, uid: number): Promise<ParsedBody | null> {
    if (!this.syncClient?.usable) throw new Error('Not connected to Yahoo.');
    if (this.accountId === null) throw new Error('No account configured.');

    const folder = foldersStore.getFolder(this.db, this.accountId, role);
    if (!folder) throw new Error(`Folder role "${role}" is not configured.`);

    return fetchAndStoreBody({ db: this.db, client: this.syncClient }, folder.path, messageRowId, uid);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private context(): SyncContext {
    if (!this.syncClient || !this.provider || this.accountId === null) {
      throw new Error('Session is not started.');
    }
    return {
      db: this.db,
      client: this.syncClient,
      provider: this.provider,
      accountId: this.accountId,
    };
  }

  private async ensureFoldersDiscovered(): Promise<void> {
    if (!this.syncClient || !this.provider || this.accountId === null) return;

    const discovered = await discoverFolders(this.syncClient, this.provider);
    foldersStore.upsertFolder(this.db, this.accountId, 'inbox', discovered.inbox);
    foldersStore.upsertFolder(this.db, this.accountId, 'sent', discovered.sent);
  }

  /**
   * Serialise sync passes. Two concurrent passes over one connection would
   * deadlock on the mailbox lock, and a second request while one is running
   * should just wait for it rather than queue a redundant pass.
   */
  private async runSync(task: () => Promise<unknown>): Promise<void> {
    if (this.pendingSync) return this.pendingSync;

    this.isSyncing = true;
    this.pendingSync = (async () => {
      try {
        await task();
        this.lastError = null;
      } catch (error) {
        this.lastError = describeImapError(error);
      } finally {
        this.isSyncing = false;
        this.pendingSync = null;
        bus.publish({ type: 'status', status: this.getStatus() });
      }
    })();

    return this.pendingSync;
  }

  /**
   * Hold INBOX open in IDLE. imapflow emits `exists` when the mailbox gains
   * messages, which we treat as a nudge to sync rather than as data.
   */
  private async startIdle(): Promise<void> {
    const client = this.idleClient;
    if (!client || this.accountId === null) return;

    const inbox = foldersStore.getFolder(this.db, this.accountId, 'inbox');
    if (!inbox) return;

    client.on('exists', () => {
      void this.runSync(() => syncFolder(this.context(), 'inbox'));
    });

    // Opening read-only keeps IDLE from touching \Recent or \Seen.
    await client.mailboxOpen(inbox.path, { readOnly: true });
  }

  private attachErrorHandlers(): void {
    for (const client of [this.syncClient, this.idleClient]) {
      if (!client) continue;
      client.on('error', (error: unknown) => {
        this.lastError = describeImapError(error);
        this.scheduleReconnect();
      });
      client.on('close', () => {
        if (!this.stopped) this.scheduleReconnect();
      });
    }
  }

  /** Exponential backoff, capped. Yahoo throttles aggressive reconnects. */
  private scheduleReconnect(): void {
    if (this.stopped) return;

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;

    setTimeout(() => {
      if (this.stopped) return;
      void (async () => {
        await this.stop();
        this.stopped = false;
        await this.start();
      })();
    }, delay).unref();
  }

  /**
   * Periodic full reconcile. IDLE reports arrivals but not deletions or flag
   * changes made in another client, so those need a poll.
   */
  private startReconcileTimer(): void {
    const intervalMs = loadConfig().reconcileIntervalMinutes * 60_000;
    this.reconcileTimer = setInterval(() => {
      if (this.stopped || !this.syncClient?.usable) return;
      void this.runSync(() => syncAll(this.context()));
    }, intervalMs);
    this.reconcileTimer.unref();
  }
}
