/**
 * WhatsApp watch list and tab status, in chrome.storage.local.
 *
 * The side panel writes the watch list; the WhatsApp tab reads it and reports
 * back a heartbeat plus the chat names it can see, so the panel can show
 * "connected" and suggest chats to watch. Nothing here leaves the browser.
 */

import { normalizeEntry } from './parse.js';

const WATCH_KEY = 'daydesk.whatsapp.watch';
const STATUS_KEY = 'daydesk.whatsapp.status';
/** Bumped by "Sync now"; the WhatsApp tab re-reads and resends what it can see. */
const RESCAN_KEY = 'daydesk.whatsapp.rescan';

/** The tab counts as connected if it reported within this window. */
export const CONNECTED_WITHIN_MS = 90_000;
const MAX_ENTRIES = 50;
const MAX_SEEN_CHATS = 80;

export interface WhatsAppStatus {
  /** Epoch ms of the WhatsApp tab's last heartbeat. */
  readonly at: number;
  /** Chat titles currently visible in the chat list, for watch-list suggestions. */
  readonly chats: readonly string[];
  /** Last time messages were delivered to the helper, and the outcome. */
  readonly lastDelivery: { readonly at: number; readonly ok: boolean; readonly message: string } | null;
  /**
   * What the last scan saw — counts and match results only, never message
   * text. Answers "why did my message not arrive?" without guessing.
   */
  readonly diagnostics?: WhatsAppDiagnostics;
}

export interface WhatsAppDiagnostics {
  readonly at: number;
  readonly watchCount: number;
  readonly openChatTitle: string | null;
  readonly openChatWatched: boolean;
  readonly openChatRows: number;
  readonly openChatTextRows: number;
  readonly listRows: number;
  readonly listWatchedRows: number;
  readonly listWatchedRecent: number;
  readonly queued: number;
}

export async function readWatchList(): Promise<readonly string[]> {
  try {
    const stored = await chrome.storage.local.get(WATCH_KEY);
    const list = stored[WATCH_KEY];
    return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export async function writeWatchList(entries: readonly string[]): Promise<readonly string[]> {
  const seen = new Set<string>();
  const cleaned = entries
    .map(normalizeEntry)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (!entry || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [WATCH_KEY]: cleaned });
  return cleaned;
}

export async function readStatus(): Promise<WhatsAppStatus | null> {
  try {
    const stored = await chrome.storage.local.get(STATUS_KEY);
    const status = stored[STATUS_KEY] as WhatsAppStatus | undefined;
    return status && typeof status.at === 'number' ? status : null;
  } catch {
    return null;
  }
}

/**
 * Status writes are read-modify-write, and the WhatsApp tab fires several close
 * together (diagnostics, delivery result, heartbeat). Chaining them keeps a
 * later write from overwriting an earlier one with stale fields.
 */
let pendingWrite: Promise<void> = Promise.resolve();

export function writeStatus(patch: Partial<WhatsAppStatus>): Promise<void> {
  const next = pendingWrite.then(() => applyStatus(patch));
  pendingWrite = next.catch(() => undefined);
  return next;
}

async function applyStatus(patch: Partial<WhatsAppStatus>): Promise<void> {
  const current = await readStatus();
  const next: WhatsAppStatus = {
    at: patch.at ?? current?.at ?? Date.now(),
    chats: (patch.chats ?? current?.chats ?? []).slice(0, MAX_SEEN_CHATS),
    lastDelivery: patch.lastDelivery !== undefined ? patch.lastDelivery : (current?.lastDelivery ?? null),
    ...((patch.diagnostics ?? current?.diagnostics) ? { diagnostics: patch.diagnostics ?? current?.diagnostics } : {}),
  };
  await chrome.storage.local.set({ [STATUS_KEY]: next });
}

/** Ask the WhatsApp tab to re-read everything it can see and send it again. */
export async function requestWhatsAppRescan(): Promise<void> {
  await chrome.storage.local.set({ [RESCAN_KEY]: Date.now() });
}

/** Listen for rescan requests — used by the WhatsApp tab. */
export function onRescanRequest(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === 'local' && RESCAN_KEY in changes) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/** Subscribe to watch-list changes only — what the WhatsApp tab itself needs. */
export function onWatchListChange(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === 'local' && WATCH_KEY in changes) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/** Subscribe to watch-list or status changes from any extension context. */
export function onWhatsAppChange(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === 'local' && (WATCH_KEY in changes || STATUS_KEY in changes)) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export { WATCH_KEY };
