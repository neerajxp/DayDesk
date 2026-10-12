/**
 * WhatsApp Web watcher.
 *
 * Runs inside your own web.whatsapp.com tab and reads only what that tab
 * already shows you. It never clicks, types, sends or opens anything, and it
 * forwards text only from chats on your DayDesk watch list — everything else
 * stays in the page.
 *
 * Two sources:
 *   - the open conversation: full messages with sender and timestamp;
 *   - the chat list: the latest-message preview of watched chats, when it is
 *     from today or yesterday, so a request is caught even if you never open
 *     the chat. The helper collapses the two when both report the same message.
 *
 * WhatsApp's markup is undocumented and changes. Every selector lives in
 * SELECTORS below, so a breakage is fixed in one place.
 */

import { cleanChatTitle, isWatched, parseDataId, parseListTime, parsePrePlainText } from '../lib/whatsapp/parse.js';
import { onWatchListChange, readWatchList, writeStatus, type WhatsAppDiagnostics } from '../lib/whatsapp/settings.js';
import type { ChatMessagePayload, DeliverRequest, DeliverResponse } from '../lib/whatsapp/messaging.js';

const SELECTORS = {
  openChat: '#main',
  openChatTitle: 'header span[dir="auto"], header [title]',
  messageRow: '[data-id]',
  messageMeta: '[data-pre-plain-text]',
  messageText: '.selectable-text',
  chatListRow: '#pane-side [role="listitem"], #pane-side [role="row"]',
  chatListSelected: '#pane-side [aria-selected="true"]',
  chatListTitles: 'span[title]',
  unreadBadge: '[aria-label*="unread" i]',
  /** The ✓ / ✓✓ status icon WhatsApp puts on a preview of your own message. */
  outgoingTick: '[data-icon^="status-"], [data-icon*="check"], [data-icon*="dblcheck"]',
} as const;

const SCAN_DEBOUNCE_MS = 1_000;
const HEARTBEAT_MS = 30_000;
const MAX_BATCH = 50;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REMEMBERED = 2_000;

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'],
  runAt: 'document_idle',
  main() {
    void startWatcher();
  },
});

async function startWatcher(): Promise<void> {
  let watchList = await readWatchList();
  const delivered = new Set<string>();
  const queued = new Map<string, ChatMessagePayload>();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let isFlushing = false;
  let diagnostics: WhatsAppDiagnostics | null = null;
  let lastDiagnosticsKey = '';

  const keyOf = (message: ChatMessagePayload): string =>
    `${message.chat.toLowerCase()}|${message.text.replace(/\s+/g, ' ').trim().toLowerCase()}`;

  const enqueue = (message: ChatMessagePayload): void => {
    if (!message.text.trim()) return;
    if (Date.now() - new Date(message.sentAt).getTime() > MAX_AGE_MS) return;
    const key = keyOf(message);
    if (!delivered.has(key)) queued.set(key, message);
  };

  const flush = async (): Promise<void> => {
    if (isFlushing || queued.size === 0) return;
    isFlushing = true;
    try {
      while (queued.size > 0) {
        const batch = [...queued.entries()].slice(0, MAX_BATCH);
        const request: DeliverRequest = { type: 'daydesk:whatsapp:deliver', messages: batch.map(([, m]) => m) };
        const response = (await chrome.runtime.sendMessage(request)) as DeliverResponse | undefined;

        if (!response?.ok) {
          // Keep them queued; the next scan retries once the helper is back.
          await writeStatus({
            lastDelivery: { at: Date.now(), ok: false, message: response?.error ?? 'DayDesk did not answer.' },
          });
          return;
        }
        for (const [key] of batch) {
          queued.delete(key);
          delivered.add(key);
        }
        if (delivered.size > MAX_REMEMBERED) delivered.clear();
        await writeStatus({
          lastDelivery: { at: Date.now(), ok: true, message: `${response.added} new, ${response.linked} linked` },
        });
      }
    } catch {
      // The extension was reloaded under this tab; this script is orphaned.
      stop();
    } finally {
      isFlushing = false;
    }
  };

  const scan = (): void => {
    const open = watchList.length > 0 ? scanOpenChat(watchList, enqueue) : EMPTY_OPEN_SCAN;
    const list = watchList.length > 0 ? scanChatList(watchList, enqueue) : EMPTY_LIST_SCAN;
    const { at: _at, ...comparable } = (diagnostics = {
      at: Date.now(),
      watchCount: watchList.length,
      ...open,
      ...list,
      queued: queued.size,
    });
    // Written only when something changed; the heartbeat refreshes it anyway.
    const key = JSON.stringify(comparable);
    if (key !== lastDiagnosticsKey) {
      lastDiagnosticsKey = key;
      void writeStatus({ diagnostics }).catch(stop);
    }
    void flush();
  };

  const scheduleScan = (): void => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      scan();
    }, SCAN_DEBOUNCE_MS);
  };

  const heartbeat = (): void => {
    if (!chrome.runtime?.id) return stop();
    void writeStatus({ at: Date.now(), chats: visibleChatTitles(), ...(diagnostics ? { diagnostics } : {}) }).catch(stop);
  };

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const heartbeatTimer = setInterval(() => {
    heartbeat();
    scheduleScan();
  }, HEARTBEAT_MS);
  // Watch-list changes only: this script's own status writes must not re-trigger it.
  const unsubscribe = onWatchListChange(() => {
    void readWatchList().then((next) => {
      watchList = next;
      scheduleScan();
    });
  });

  function stop(): void {
    observer.disconnect();
    clearInterval(heartbeatTimer);
    if (scanTimer) clearTimeout(scanTimer);
    try {
      unsubscribe();
    } catch {
      // Already torn down with the extension context.
    }
  }

  heartbeat();
  scheduleScan();
}

// ── DOM reading ─────────────────────────────────────────────────────────────

/** Visible text of a message, with emoji (rendered as <img alt="😀">) kept. */
function textOf(element: Element): string {
  let text = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
    else if (node instanceof HTMLImageElement) text += node.alt;
    else if (node instanceof HTMLBRElement) text += '\n';
    else node.childNodes.forEach(walk);
  };
  walk(element);
  return text.trim();
}

type OpenScan = Pick<WhatsAppDiagnostics, 'openChatTitle' | 'openChatWatched' | 'openChatRows' | 'openChatTextRows'>;
type ListScan = Pick<WhatsAppDiagnostics, 'listRows' | 'listWatchedRows' | 'listWatchedRecent'>;
const EMPTY_OPEN_SCAN: OpenScan = { openChatTitle: null, openChatWatched: false, openChatRows: 0, openChatTextRows: 0 };
const EMPTY_LIST_SCAN: ListScan = { listRows: 0, listWatchedRows: 0, listWatchedRecent: 0 };

/** Candidate names for the open chat: its header, then the selected chat-list row. */
function openChatTitles(main: Element): string[] {
  const header = main.querySelector(SELECTORS.openChatTitle);
  const selected = document.querySelector(SELECTORS.chatListSelected)?.querySelector(SELECTORS.chatListTitles);
  return [
    header?.getAttribute('title') || header?.textContent || '',
    selected?.getAttribute('title') || '',
  ]
    .map(cleanChatTitle)
    .filter(Boolean);
}

function scanOpenChat(watchList: readonly string[], enqueue: (message: ChatMessagePayload) => void): OpenScan {
  const main = document.querySelector(SELECTORS.openChat);
  if (!main) return EMPTY_OPEN_SCAN;

  const rows = main.querySelectorAll<HTMLElement>(SELECTORS.messageRow);
  const firstMeta = rows[0]?.dataset.id ? parseDataId(rows[0].dataset.id) : null;
  const titles = openChatTitles(main);
  const title = titles.find((candidate) => isWatched(watchList, { title: candidate, jid: firstMeta?.chatJid ?? null }));
  const result = { openChatTitle: titles[0] ?? null, openChatWatched: Boolean(title), openChatRows: rows.length };
  if (!title) return { ...result, openChatTextRows: 0 };

  let textRows = 0;
  for (const row of rows) {
    const meta = row.dataset.id ? parseDataId(row.dataset.id) : null;
    const container = row.querySelector(SELECTORS.messageMeta);
    if (!meta || !container) continue; // media-only or system messages carry no text
    textRows += 1;

    const { sentAt, sender } = parsePrePlainText(container.getAttribute('data-pre-plain-text') ?? '', navigator.language);
    const textElement = container.querySelector(SELECTORS.messageText) ?? container;
    enqueue({
      chat: title,
      sender: meta.isFromMe ? 'You' : sender,
      text: textOf(textElement),
      isFromMe: meta.isFromMe,
      sentAt: (sentAt ?? new Date()).toISOString(),
    });
  }
  return { ...result, openChatTextRows: textRows };
}

interface ChatListEntry {
  readonly title: string;
  readonly preview: string;
  readonly isUnread: boolean;
  readonly isOutgoing: boolean;
  /** When the preview's message was sent, if the row's label says today or yesterday. */
  readonly sentAt: Date | null;
}

/** The row's time label ("9:42 PM", "Yesterday") — the first short leaf text that parses as one. */
function rowTime(row: Element): Date | null {
  for (const element of row.querySelectorAll('div, span')) {
    if (element.childElementCount > 0) continue;
    const text = element.textContent?.trim() ?? '';
    if (text.length > 0 && text.length <= 12) {
      const parsed = parseListTime(text);
      if (parsed) return parsed;
    }
  }
  return null;
}

function chatListEntries(): ChatListEntry[] {
  return [...document.querySelectorAll(SELECTORS.chatListRow)].flatMap((row) => {
    const titles = [...row.querySelectorAll(SELECTORS.chatListTitles)]
      .map((span) => span.getAttribute('title')?.trim() ?? '')
      .filter(Boolean);
    const [title, ...rest] = titles;
    if (!title) return [];
    const preview = rest.reverse().find((text) => text !== title) ?? '';
    return [
      {
        title: cleanChatTitle(title),
        preview,
        isUnread: row.querySelector(SELECTORS.unreadBadge) !== null,
        isOutgoing: row.querySelector(SELECTORS.outgoingTick) !== null,
        sentAt: rowTime(row),
      },
    ];
  });
}

function scanChatList(watchList: readonly string[], enqueue: (message: ChatMessagePayload) => void): ListScan {
  const entries = chatListEntries();
  let watchedRows = 0;
  let recent = 0;
  for (const entry of entries) {
    if (!isWatched(watchList, { title: entry.title, jid: null })) continue;
    watchedRows += 1;
    // Unread previews are new by definition; a read one counts only if it is from
    // today or yesterday — an old preview stamped "now" would get its dates wrong.
    const sentAt = entry.sentAt ?? (entry.isUnread ? new Date() : null);
    if (!entry.preview || !sentAt) continue;
    recent += 1;
    enqueue({
      chat: entry.title,
      sender: entry.isOutgoing ? 'You' : '',
      text: entry.preview,
      isFromMe: entry.isOutgoing,
      sentAt: sentAt.toISOString(),
    });
  }
  return { listRows: entries.length, listWatchedRows: watchedRows, listWatchedRecent: recent };
}

function visibleChatTitles(): string[] {
  return [...new Set(chatListEntries().map((entry) => entry.title))];
}
