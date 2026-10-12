/**
 * Task persistence, plus the bookkeeping the scanner needs to know which
 * emails it has already looked at.
 */

import type { Database } from 'better-sqlite3';
import type {
  ChatSource,
  LinkRelation,
  RelatedItem,
  Task,
  TaskCandidate,
  TaskKind,
  TaskSource,
  TaskStatus,
} from '../types/tasks.js';
import type { TaskProfile } from '../tasks/correlate.js';
import { isSelf, loadSelfIdentity, NO_IDENTITY, type SelfIdentity } from './identity.js';

interface TaskRow {
  readonly id: number;
  readonly kind: TaskKind;
  readonly title: string;
  readonly due_date: string | null;
  readonly amount: string | null;
  readonly status: TaskStatus;
  readonly source: TaskSource;
  readonly created_at: string;
  readonly done_at: string | null;
  readonly message_id: number | null;
  readonly subject: string | null;
  readonly from_name: string | null;
  readonly from_addr: string | null;
  readonly internal_date: string | null;
  readonly chat_message_id: number | null;
  readonly chat_source: ChatSource | null;
  readonly chat_name: string | null;
  readonly chat_sender: string | null;
  readonly chat_text: string | null;
  readonly chat_sent_at: string | null;
}

const SELECT_TASK = `
  SELECT tasks.*, messages.subject, messages.from_name, messages.from_addr, messages.internal_date,
         chat.source AS chat_source, chat.chat_name, chat.sender AS chat_sender,
         chat.text AS chat_text, chat.sent_at AS chat_sent_at
  FROM tasks
  LEFT JOIN messages ON messages.id = tasks.message_id
  LEFT JOIN chat_messages chat ON chat.id = tasks.chat_message_id`;

function rowToTask(row: TaskRow, related: readonly RelatedItem[] = [], identity: SelfIdentity = NO_IDENTITY): Task {
  return {
    related,
    id: row.id,
    kind: row.kind,
    title: row.title,
    dueDate: row.due_date,
    amount: row.amount,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    doneAt: row.done_at,
    message:
      row.message_id !== null && row.internal_date !== null
        ? {
            id: row.message_id,
            subject: row.subject ?? '',
            fromName: row.from_name ?? '',
            fromAddress: row.from_addr ?? '',
            receivedAt: row.internal_date,
            isFromYou: isSelf(identity, { name: row.from_name ?? '', address: row.from_addr ?? '' }),
          }
        : null,
    chat:
      row.chat_message_id !== null && row.chat_sent_at !== null
        ? {
            id: row.chat_message_id,
            source: row.chat_source ?? 'whatsapp',
            chatName: row.chat_name ?? '',
            sender: row.chat_sender ?? '',
            text: row.chat_text ?? '',
            sentAt: row.chat_sent_at,
            // Your own chat is titled with your name; a group message from you says "You".
            isFromYou:
              isSelf(identity, { name: row.chat_sender ?? '' }) ||
              (!row.chat_sender && isSelf(identity, { name: row.chat_name ?? '' })),
          }
        : null,
  };
}

/**
 * Everything still open, plus anything finished since `doneSince` — so a task
 * ticked off this morning stays visible (greyed) for the rest of the day.
 *
 * Dated tasks first, soonest first; undated after, newest first.
 */
export function listTasks(db: Database, accountId: number, options: { doneSince: string }): readonly Task[] {
  const rows = db
    .prepare(
      `${SELECT_TASK}
       WHERE tasks.account_id = ?
         AND (tasks.status = 'open' OR (tasks.status = 'done' AND tasks.done_at >= ?))
       ORDER BY tasks.due_date IS NULL, tasks.due_date, tasks.created_at DESC, tasks.id DESC`,
    )
    .all(accountId, options.doneSince) as TaskRow[];
  const identity = loadSelfIdentity(db, accountId);
  const related = relatedFor(db, rows.map((row) => row.id), identity);
  return rows.map((row) => rowToTask(row, related.get(row.id), identity));
}

export function getTask(db: Database, accountId: number, id: number): Task | null {
  const row = db.prepare(`${SELECT_TASK} WHERE tasks.account_id = ? AND tasks.id = ?`).get(accountId, id) as
    | TaskRow
    | undefined;
  if (!row) return null;
  const identity = loadSelfIdentity(db, accountId);
  return rowToTask(row, relatedFor(db, [row.id], identity).get(row.id), identity);
}

export function createManualTask(
  db: Database,
  accountId: number,
  input: { title: string; kind: TaskKind; dueDate: string | null; messageId?: number | null },
): Task {
  const result = db
    .prepare(
      `INSERT INTO tasks (account_id, message_id, kind, title, due_date, source, created_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
    )
    .run(accountId, input.messageId ?? null, input.kind, input.title, input.dueDate, new Date().toISOString());
  return getTask(db, accountId, Number(result.lastInsertRowid))!;
}

export interface TaskPatch {
  readonly status?: TaskStatus;
  /** `null` clears the date; omitted leaves it alone. */
  readonly dueDate?: string | null;
  readonly title?: string;
}

export function updateTask(db: Database, accountId: number, id: number, patch: TaskPatch): Task | null {
  const existing = getTask(db, accountId, id);
  if (!existing) return null;

  const status = patch.status ?? existing.status;
  // done_at tracks the transition, not the request: re-sending "done" keeps the original time.
  const doneAt =
    status === 'done' ? (existing.status === 'done' ? existing.doneAt : new Date().toISOString()) : null;

  db.prepare('UPDATE tasks SET status = ?, done_at = ?, due_date = ?, title = ? WHERE id = ? AND account_id = ?').run(
    status,
    doneAt,
    patch.dueDate === undefined ? existing.dueDate : patch.dueDate,
    patch.title ?? existing.title,
    id,
    accountId,
  );
  return getTask(db, accountId, id);
}

/** What a rule-found task points back to: an email or a chat message. */
export type TaskOrigin = { readonly messageId: number } | { readonly chatMessageId: number };

/**
 * Store what the rules found in one email or chat message. Returns only the
 * genuinely new tasks.
 *
 * A rescan (e.g. once the body arrives) may refine an *open* task's date,
 * amount or title, but never reopens or rewrites one the user already
 * finished or dismissed.
 */
export function saveRuleTasks(
  db: Database,
  accountId: number,
  origin: TaskOrigin,
  candidates: readonly TaskCandidate[],
): readonly TaskCandidate[] {
  // Column names come from this fixed union, never from input.
  const column = 'messageId' in origin ? 'message_id' : 'chat_message_id';
  const originId = 'messageId' in origin ? origin.messageId : origin.chatMessageId;

  const find = db.prepare(`SELECT id FROM tasks WHERE ${column} = ? AND kind = ?`);
  const insert = db.prepare(
    `INSERT INTO tasks (account_id, ${column}, kind, title, due_date, amount, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'rule', ?)`,
  );
  const refine = db.prepare(
    `UPDATE tasks SET title = ?, due_date = COALESCE(?, due_date), amount = COALESCE(?, amount)
     WHERE id = ? AND status = 'open' AND source = 'rule'`,
  );

  return db.transaction(() => {
    const added: TaskCandidate[] = [];
    for (const candidate of candidates) {
      const existing = find.get(originId, candidate.kind) as { id: number } | undefined;
      if (existing) {
        refine.run(candidate.title, candidate.dueDate, candidate.amount, existing.id);
        continue;
      }
      insert.run(
        accountId,
        originId,
        candidate.kind,
        candidate.title,
        candidate.dueDate,
        candidate.amount,
        new Date().toISOString(),
      );
      added.push(candidate);
    }
    return added;
  })();
}

// ── Trail: links between a task and later emails / chat messages ────────────

interface LinkRow {
  readonly task_id: number;
  readonly relation: LinkRelation;
  readonly message_id: number | null;
  readonly subject: string | null;
  readonly from_name: string | null;
  readonly from_addr: string | null;
  readonly snippet: string | null;
  readonly internal_date: string | null;
  readonly chat_message_id: number | null;
  readonly chat_source: ChatSource | null;
  readonly chat_name: string | null;
  readonly sender: string | null;
  readonly text: string | null;
  readonly sent_at: string | null;
}

function relatedFor(
  db: Database,
  taskIds: readonly number[],
  identity: SelfIdentity,
): ReadonlyMap<number, readonly RelatedItem[]> {
  const byTask = new Map<number, RelatedItem[]>();
  if (taskIds.length === 0) return byTask;

  // json_each keeps this one parameterised query regardless of list length.
  const rows = db
    .prepare(
      `SELECT l.task_id, l.relation, l.message_id, l.chat_message_id,
              m.subject, m.from_name, m.from_addr, m.snippet, m.internal_date,
              c.source AS chat_source, c.chat_name, c.sender, c.text, c.sent_at
       FROM task_links l
       LEFT JOIN messages m ON m.id = l.message_id
       LEFT JOIN chat_messages c ON c.id = l.chat_message_id
       WHERE l.task_id IN (SELECT value FROM json_each(?)) AND l.is_hidden = 0
       ORDER BY COALESCE(m.internal_date, c.sent_at), l.id`,
    )
    .all(JSON.stringify(taskIds)) as LinkRow[];

  for (const row of rows) {
    const item: RelatedItem | null =
      row.message_id !== null && row.internal_date !== null
        ? {
            relation: row.relation,
            source: 'email',
            refId: row.message_id,
            label: row.subject ?? '',
            from: row.from_name || row.from_addr || '',
            text: row.snippet ?? '',
            at: row.internal_date,
            isFromYou: isSelf(identity, { name: row.from_name ?? '', address: row.from_addr ?? '' }),
          }
        : row.chat_message_id !== null && row.sent_at !== null
          ? {
              relation: row.relation,
              source: row.chat_source ?? 'whatsapp',
              refId: row.chat_message_id,
              label: row.chat_name ?? '',
              from: row.sender ?? '',
              text: row.text ?? '',
              at: row.sent_at,
              isFromYou:
                isSelf(identity, { name: row.sender ?? '' }) || (!row.sender && isSelf(identity, { name: row.chat_name ?? '' })),
            }
          : null;
    if (item) byTask.set(row.task_id, [...(byTask.get(row.task_id) ?? []), item]);
  }
  return byTask;
}

function originColumn(origin: TaskOrigin): { column: 'message_id' | 'chat_message_id'; id: number } {
  return 'messageId' in origin
    ? { column: 'message_id', id: origin.messageId }
    : { column: 'chat_message_id', id: origin.chatMessageId };
}

export function addTaskLink(db: Database, taskId: number, origin: TaskOrigin, relation: LinkRelation): boolean {
  const { column, id } = originColumn(origin);
  const result = db
    .prepare(
      `INSERT INTO task_links (task_id, ${column}, relation, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(taskId, id, relation, new Date().toISOString());
  return result.changes > 0;
}

/**
 * Hide (or restore) one message on a task's trail. Returns false when that
 * message is not on that task — including when the task belongs to another
 * account.
 */
export function setRelatedHidden(
  db: Database,
  accountId: number,
  taskId: number,
  ref: { source: 'email' | ChatSource; refId: number },
  hidden: boolean,
): boolean {
  const column = ref.source === 'email' ? 'message_id' : 'chat_message_id';
  const result = db
    .prepare(
      `UPDATE task_links SET is_hidden = ?
       WHERE task_id = ? AND ${column} = ?
         AND task_id IN (SELECT id FROM tasks WHERE account_id = ?)`,
    )
    .run(hidden ? 1 : 0, taskId, ref.refId, accountId);
  return result.changes > 0;
}

/** True when this email / chat message already sits on some task's trail. */
export function isLinked(db: Database, origin: TaskOrigin): boolean {
  const { column, id } = originColumn(origin);
  return db.prepare(`SELECT 1 FROM task_links WHERE ${column} = ? LIMIT 1`).get(id) !== undefined;
}

export function hasOwnTask(db: Database, origin: TaskOrigin, kind: TaskKind): boolean {
  const { column, id } = originColumn(origin);
  return db.prepare(`SELECT 1 FROM tasks WHERE ${column} = ? AND kind = ?`).get(id, kind) !== undefined;
}

/** A follow-up that names a date fills in a task that had none; it never moves a date already set. */
export function fillDueDate(db: Database, taskId: number, dueDate: string | null): void {
  if (!dueDate) return;
  db.prepare("UPDATE tasks SET due_date = ? WHERE id = ? AND due_date IS NULL AND status = 'open'").run(dueDate, taskId);
}

/**
 * Open tasks created since `sinceIso`, in the shape the correlator matches
 * against. A task's text is what produced it: email subject + snippet, or the
 * chat message.
 */
export function listOpenProfiles(
  db: Database,
  accountId: number,
  options: { sinceIso: string; excluding: TaskOrigin },
): readonly TaskProfile[] {
  const { column, id } = originColumn(options.excluding);
  const rows = db
    .prepare(
      `SELECT t.id, t.kind, t.title, t.amount,
              COALESCE(m.subject || ' ' || m.snippet, c.text, '') AS text
       FROM tasks t
       LEFT JOIN messages m ON m.id = t.message_id
       LEFT JOIN chat_messages c ON c.id = t.chat_message_id
       WHERE t.account_id = ? AND t.status = 'open' AND t.created_at >= ?
         AND (t.${column} IS NULL OR t.${column} != ?)`,
    )
    .all(accountId, options.sinceIso, id) as { id: number; kind: TaskKind; title: string; amount: string | null; text: string }[];
  return rows;
}

// ── Scanner bookkeeping ─────────────────────────────────────────────────────

export interface ScanTarget {
  readonly id: number;
  readonly subject: string;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly receivedAt: string;
  readonly bodyText: string | null;
  readonly hasBody: boolean;
}

/**
 * Inbox messages since `sinceIso` that the scanner has not seen, saw before
 * their body arrived, or saw with an older version of the rules.
 */
export function listScanTargets(
  db: Database,
  accountId: number,
  sinceIso: string,
  rulesVersion: number,
): readonly ScanTarget[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.subject, m.from_name, m.from_addr, m.internal_date,
              b.body_text, (b.message_id IS NOT NULL) AS has_body
       FROM messages m
       JOIN folders f ON f.id = m.folder_id AND f.role = 'inbox' AND f.account_id = ?
       LEFT JOIN message_bodies b ON b.message_id = m.id
       LEFT JOIN task_scans s ON s.message_id = m.id
       WHERE m.internal_date >= ?
         AND (s.message_id IS NULL
              OR (s.had_body = 0 AND b.message_id IS NOT NULL)
              OR s.rules_version < ?)
       ORDER BY m.internal_date DESC`,
    )
    .all(accountId, sinceIso, rulesVersion) as {
    id: number;
    subject: string;
    from_name: string;
    from_addr: string;
    internal_date: string;
    body_text: string | null;
    has_body: number;
  }[];

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    fromName: row.from_name,
    fromAddress: row.from_addr,
    receivedAt: row.internal_date,
    bodyText: row.body_text,
    hasBody: row.has_body === 1,
  }));
}

export function markScanned(db: Database, messageId: number, hadBody: boolean, rulesVersion: number): void {
  db.prepare(
    `INSERT INTO task_scans (message_id, had_body, scanned_at, rules_version) VALUES (?, ?, ?, ?)
     ON CONFLICT (message_id) DO UPDATE SET
       had_body = excluded.had_body,
       scanned_at = excluded.scanned_at,
       rules_version = excluded.rules_version`,
  ).run(messageId, hadBody ? 1 : 0, new Date().toISOString(), rulesVersion);
}

/** Recent inbox messages with no cached body, newest first — the prefetch queue. */
export function listMissingBodies(
  db: Database,
  accountId: number,
  options: { sinceIso: string; limit: number; maxBytes: number },
): readonly { id: number; uid: number }[] {
  return db
    .prepare(
      `SELECT m.id, m.uid
       FROM messages m
       JOIN folders f ON f.id = m.folder_id AND f.role = 'inbox' AND f.account_id = ?
       LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE m.internal_date >= ? AND b.message_id IS NULL AND m.size <= ?
       ORDER BY m.internal_date DESC
       LIMIT ?`,
    )
    .all(accountId, options.sinceIso, options.maxBytes, options.limit) as { id: number; uid: number }[];
}
