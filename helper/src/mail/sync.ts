/**
 * Sync orchestration.
 *
 * One pass over a folder does, in order:
 *   1. EXAMINE the mailbox (read-only) and read UIDVALIDITY / UIDNEXT.
 *   2. Bail out to a full reset if UIDVALIDITY changed — every stored UID is
 *      meaningless at that point.
 *   3. First pass only: anchor a floor at the Nth-newest message and fetch that
 *      window's headers.
 *   4. Later passes: fetch anything above the local high-water mark, extend the
 *      floor downward if the configured backlog grew, drop messages the server
 *      no longer has, and refresh flags for the rest.
 *
 * Headers only. Bodies are fetched on demand by the bodies module.
 */

import type { Database } from 'better-sqlite3';
import type { ImapFlow } from 'imapflow';
import type { FolderRole } from '../types/mail.js';
import type { MailProvider } from '../providers/types.js';
import { loadConfig } from '../config/index.js';
import { bus } from '../events.js';
import * as foldersStore from '../store/folders.js';
import * as messagesStore from '../store/messages.js';
import { batchUids, selectBackfillUids, selectInitialWindow, selectNewUids } from './anchor.js';
import { changedFlags, diffUids, isUidMapStillValid, type FlagChange } from './reconcile.js';
import { makeSnippet, toMessageInsert, type RawFetchedMessage } from './parse.js';
import { withReadOnlyMailbox } from './client.js';

export interface SyncContext {
  readonly db: Database;
  readonly client: ImapFlow;
  readonly provider: MailProvider;
  readonly accountId: number;
}

export interface SyncOutcome {
  readonly role: FolderRole;
  readonly added: number;
  readonly removed: number;
  readonly flagsUpdated: number;
  readonly wasReset: boolean;
  readonly truncatedByProviderCap: boolean;
}

const HEADER_FIELDS = {
  uid: true,
  envelope: true,
  flags: true,
  size: true,
  internalDate: true,
  bodyStructure: true,
} as const;

export async function syncFolder(ctx: SyncContext, role: FolderRole): Promise<SyncOutcome> {
  const config = loadConfig();
  const folder = foldersStore.getFolder(ctx.db, ctx.accountId, role);
  if (!folder) throw new Error(`Folder role "${role}" has not been discovered yet.`);

  bus.publish({ type: 'sync:started', role });

  try {
    return await withReadOnlyMailbox(ctx.client, folder.path, async (mailbox) => {
      const serverUidValidity = String(mailbox.uidValidity);
      let wasReset = false;

      // --- Step 2: has the server invalidated our UID map? --------------------
      if (!isUidMapStillValid(folder.uid_validity, serverUidValidity)) {
        foldersStore.clearFolderMessages(ctx.db, folder.id);
        wasReset = true;
      }

      const serverUids = await ctx.client.search({ all: true }, { uid: true });
      const uids = Array.isArray(serverUids) ? serverUids.map(Number) : [];

      const current = foldersStore.getFolder(ctx.db, ctx.accountId, role)!;
      const hasFloor = current.floor_uid !== null && !wasReset;

      let toFetch: readonly number[];
      let newFloorUid: number | null = null;
      let truncated = false;

      if (!hasFloor) {
        // --- Step 3: first pass. Anchor the floor. ---------------------------
        const window = selectInitialWindow(uids, config.initialBacklog);
        if (!window) {
          foldersStore.setSyncState(ctx.db, current.id, {
            uidValidity: serverUidValidity,
            uidNext: Number(mailbox.uidNext ?? 0) || null,
            highestModseq: mailbox.highestModseq ? String(mailbox.highestModseq) : null,
          });
          bus.publish({ type: 'sync:finished', role, added: 0, removed: 0 });
          return { role, added: 0, removed: 0, flagsUpdated: 0, wasReset, truncatedByProviderCap: false };
        }
        toFetch = window.uids;
        newFloorUid = window.floorUid;
        truncated = window.truncated;
      } else {
        // --- Step 4: incremental. New mail, plus any deepened backlog. -------
        const highWaterMark = messagesStore.maxUid(ctx.db, current.id);
        const fresh = selectNewUids(uids, highWaterMark);
        const backfill = selectBackfillUids(uids, current.floor_uid!, config.initialBacklog);
        toFetch = [...backfill, ...fresh];
        if (backfill.length > 0) newFloorUid = backfill[0]!;
      }

      // --- Fetch headers in batches ----------------------------------------
      let added = 0;
      const batches = batchUids(toFetch, config.fetchBatchSize);
      let processed = 0;

      for (const batch of batches) {
        const inserts = [];
        // imapflow wants a mutable array for the fetch range.
        for await (const message of ctx.client.fetch([...batch], HEADER_FIELDS, { uid: true })) {
          const insert = toMessageInsert(message as unknown as RawFetchedMessage);
          inserts.push({ ...insert, snippet: makeSnippet(insert.subject) });
        }
        added += messagesStore.insertMessages(ctx.db, current.id, inserts);
        processed += batch.length;
        bus.publish({ type: 'sync:progress', role, synced: processed, total: toFetch.length });
      }

      if (newFloorUid !== null) {
        const floorDate = oldestInternalDate(ctx.db, current.id) ?? new Date().toISOString();
        foldersStore.setFloor(ctx.db, current.id, newFloorUid, floorDate);
      }

      // --- Reconcile deletions and flags -----------------------------------
      const refreshed = foldersStore.getFolder(ctx.db, ctx.accountId, role)!;
      const localUids = messagesStore.listUids(ctx.db, refreshed.id);
      const { removed: removedUids } = diffUids(localUids, uids, refreshed.floor_uid);
      const removed = messagesStore.deleteByUids(ctx.db, refreshed.id, removedUids);

      const flagsUpdated = await refreshFlags(ctx, refreshed.id, localUids, removedUids);

      foldersStore.setSyncState(ctx.db, refreshed.id, {
        uidValidity: serverUidValidity,
        uidNext: Number(mailbox.uidNext ?? 0) || null,
        highestModseq: mailbox.highestModseq ? String(mailbox.highestModseq) : null,
      });

      bus.publish({ type: 'sync:finished', role, added, removed });
      if (added > 0 && role === 'inbox') {
        bus.publish({ type: 'mail:new', role, count: added });
      }

      return {
        role,
        added,
        removed,
        flagsUpdated,
        wasReset,
        truncatedByProviderCap:
          truncated && uids.length >= (ctx.provider.capabilities.maxMessagesPerFolder ?? Infinity),
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    bus.publish({ type: 'sync:error', role, message });
    throw error;
  }
}

/**
 * Re-read flags for stored messages so read/unread state set in Yahoo Mail
 * elsewhere shows up here. DayDesk never writes flags back.
 */
async function refreshFlags(
  ctx: SyncContext,
  folderId: number,
  localUids: readonly number[],
  skipUids: readonly number[],
): Promise<number> {
  const skip = new Set(skipUids);
  const targets = localUids.filter((uid) => !skip.has(uid));
  if (targets.length === 0) return 0;

  const localFlags = new Map<number, readonly string[]>(
    (
      ctx.db
        .prepare('SELECT uid, flags_json FROM messages WHERE folder_id = ?')
        .all(folderId) as { uid: number; flags_json: string }[]
    ).map((row) => [row.uid, safeParseFlags(row.flags_json)]),
  );

  const serverFlags: FlagChange[] = [];
  for (const batch of batchUids(targets, loadConfig().fetchBatchSize)) {
    for await (const message of ctx.client.fetch([...batch], { uid: true, flags: true }, { uid: true })) {
      const flags = message.flags ? [...message.flags] : [];
      serverFlags.push({ uid: Number(message.uid), flags });
    }
  }

  const changes = changedFlags(localFlags, serverFlags);
  return messagesStore.updateFlags(ctx.db, folderId, changes);
}

function safeParseFlags(json: string): readonly string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function oldestInternalDate(db: Database, folderId: number): string | null {
  const row = db
    .prepare('SELECT MIN(internal_date) AS d FROM messages WHERE folder_id = ?')
    .get(folderId) as { d: string | null };
  return row.d;
}

/** Sync both folders in sequence. Inbox first — it is what the panel opens on. */
export async function syncAll(ctx: SyncContext): Promise<readonly SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const role of ['inbox', 'sent'] as const) {
    outcomes.push(await syncFolder(ctx, role));
  }
  return outcomes;
}
