/**
 * Re-reads stored WhatsApp messages with the current chat rules.
 *
 * Chat messages are read once on arrival. When the rules improve, this pass
 * gives recent messages a second look, so an instruction like "Pay pseg 25$
 * today" that older rules missed still becomes a task. Mirrors what
 * RULES_VERSION does for email in scan.ts.
 */

import type { Database } from 'better-sqlite3';
import * as chatStore from '../store/chat.js';
import { CHAT_RULES_VERSION, extractChatTask } from './chat.js';
import { addDays } from './dates.js';
import { ingest } from './ingest.js';

/** Same horizon as chat intake: older chat is history, not news. */
const RESCAN_WINDOW_DAYS = 7;

export interface ChatRescanResult {
  readonly checked: number;
  readonly added: number;
  readonly linked: number;
  readonly firstTitle: string | null;
}

export function rescanChatMessages(db: Database, accountId: number, now: Date): ChatRescanResult {
  const targets = chatStore.listChatRescanTargets(db, {
    sinceIso: addDays(now, -RESCAN_WINDOW_DAYS).toISOString(),
    rulesVersion: CHAT_RULES_VERSION,
  });

  let added = 0;
  let linked = 0;
  let firstTitle: string | null = null;

  for (const message of targets) {
    const candidate = extractChatTask(message);
    const result = ingest(db, accountId, { chatMessageId: message.id }, {
      candidates: candidate ? [candidate] : [],
      text: message.text,
      now,
    });
    chatStore.markChatChecked(db, message.id, CHAT_RULES_VERSION);
    added += result.added.length;
    linked += result.linked;
    firstTitle ??= result.added[0]?.title ?? null;
  }

  return { checked: targets.length, added, linked, firstTitle };
}
