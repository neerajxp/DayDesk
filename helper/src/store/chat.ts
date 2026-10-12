/**
 * Chat message persistence (WhatsApp).
 *
 * Only messages from watched chats are ever stored, and only their text —
 * no media, no contact lists.
 */

import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { ChatSource } from '../types/tasks.js';
import { toDateKey } from '../tasks/dates.js';

export interface ChatMessageInput {
  readonly source: ChatSource;
  readonly chatName: string;
  readonly sender: string;
  readonly text: string;
  readonly isFromMe: boolean;
  readonly sentAt: Date;
}

/**
 * Identity of a chat message: chat + calendar day + text.
 *
 * The same message can arrive twice — once as a chat-list preview, once from
 * the open conversation, with different ids and timestamp precision — so the
 * key deliberately ignores both. The day keeps "pay maid salary" next month
 * from being swallowed as a duplicate of this month's.
 */
export function chatMessageKey(input: ChatMessageInput): string {
  const normalized = input.text.replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256')
    .update(`${input.chatName.trim().toLowerCase()}\n${toDateKey(input.sentAt)}\n${normalized}`)
    .digest('hex');
}

export interface StoredChatMessage {
  readonly id: number;
  readonly chatName: string;
  readonly sender: string;
  readonly text: string;
  readonly isFromMe: boolean;
  readonly sentAt: Date;
}

/** Messages sent since `sinceIso` that an older version of the chat rules last read. */
export function listChatRescanTargets(
  db: Database,
  options: { sinceIso: string; rulesVersion: number },
): readonly StoredChatMessage[] {
  const rows = db
    .prepare(
      `SELECT id, chat_name, sender, text, is_from_me, sent_at FROM chat_messages
       WHERE sent_at >= ? AND rules_version < ?
       ORDER BY sent_at`,
    )
    .all(options.sinceIso, options.rulesVersion) as {
    id: number;
    chat_name: string;
    sender: string;
    text: string;
    is_from_me: number;
    sent_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    chatName: row.chat_name,
    sender: row.sender,
    text: row.text,
    isFromMe: row.is_from_me === 1,
    sentAt: new Date(row.sent_at),
  }));
}

export function markChatChecked(db: Database, id: number, rulesVersion: number): void {
  db.prepare('UPDATE chat_messages SET rules_version = ? WHERE id = ?').run(rulesVersion, id);
}

/** Insert one message. `isNew` is false when it was already stored. */
export function insertChatMessage(db: Database, input: ChatMessageInput): { id: number; isNew: boolean } {
  const key = chatMessageKey(input);
  const result = db
    .prepare(
      `INSERT INTO chat_messages (source, ext_key, chat_name, sender, text, is_from_me, sent_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source, ext_key) DO NOTHING`,
    )
    .run(
      input.source,
      key,
      input.chatName,
      input.sender,
      input.text,
      input.isFromMe ? 1 : 0,
      input.sentAt.toISOString(),
      new Date().toISOString(),
    );

  if (result.changes > 0) return { id: Number(result.lastInsertRowid), isNew: true };

  const existing = db
    .prepare('SELECT id FROM chat_messages WHERE source = ? AND ext_key = ?')
    .get(input.source, key) as { id: number };
  return { id: existing.id, isNew: false };
}
