import type { Database } from 'better-sqlite3';
import type { FolderRole, MailAddress, MessageDetail, MessageSummary } from '../types/mail.js';

export interface MessageRow {
  readonly id: number;
  readonly folder_id: number;
  readonly uid: number;
  readonly message_id: string | null;
  readonly subject: string;
  readonly from_name: string;
  readonly from_addr: string;
  readonly to_json: string;
  readonly cc_json: string;
  readonly date: string | null;
  readonly internal_date: string;
  readonly size: number;
  readonly flags_json: string;
  readonly is_seen: number;
  readonly is_flagged: number;
  readonly has_attachments: number;
  readonly snippet: string;
}

/** The shape the sync engine produces for insertion. */
export interface MessageInsert {
  readonly uid: number;
  readonly messageId: string | null;
  readonly subject: string;
  readonly from: MailAddress | null;
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly date: string | null;
  readonly internalDate: string;
  readonly size: number;
  readonly flags: readonly string[];
  readonly isSeen: boolean;
  readonly isFlagged: boolean;
  readonly hasAttachments: boolean;
  readonly snippet: string;
}

function parseAddresses(json: string): readonly MailAddress[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as MailAddress[]) : [];
  } catch {
    return [];
  }
}

export function rowToSummary(row: MessageRow, role: FolderRole): MessageSummary {
  return {
    id: row.id,
    folderRole: role,
    uid: row.uid,
    messageId: row.message_id,
    subject: row.subject,
    from: row.from_addr ? { name: row.from_name, address: row.from_addr } : null,
    to: parseAddresses(row.to_json),
    cc: parseAddresses(row.cc_json),
    date: row.date,
    internalDate: row.internal_date,
    size: row.size,
    isSeen: row.is_seen === 1,
    isFlagged: row.is_flagged === 1,
    hasAttachments: row.has_attachments === 1,
    snippet: row.snippet,
  };
}

/**
 * Insert header rows, ignoring any UID already present.
 *
 * Also seeds the FTS row with subject and sender. The body column is filled in
 * later by saveBody(), since bodies are fetched lazily on first open.
 */
export function insertMessages(
  db: Database,
  folderId: number,
  messages: readonly MessageInsert[],
): number {
  const insertMessage = db.prepare(
    `INSERT INTO messages (
       folder_id, uid, message_id, subject, from_name, from_addr,
       to_json, cc_json, date, internal_date, size, flags_json,
       is_seen, is_flagged, has_attachments, snippet
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (folder_id, uid) DO NOTHING`,
  );
  const insertFts = db.prepare(
    'INSERT INTO messages_fts (rowid, subject, sender, body) VALUES (?, ?, ?, ?)',
  );

  return db.transaction(() => {
    let inserted = 0;
    for (const message of messages) {
      const result = insertMessage.run(
        folderId,
        message.uid,
        message.messageId,
        message.subject,
        message.from?.name ?? '',
        message.from?.address ?? '',
        JSON.stringify(message.to),
        JSON.stringify(message.cc),
        message.date,
        message.internalDate,
        message.size,
        JSON.stringify(message.flags),
        message.isSeen ? 1 : 0,
        message.isFlagged ? 1 : 0,
        message.hasAttachments ? 1 : 0,
        message.snippet,
      );

      if (result.changes > 0) {
        const sender = [message.from?.name, message.from?.address].filter(Boolean).join(' ');
        insertFts.run(Number(result.lastInsertRowid), message.subject, sender, message.snippet);
        inserted += 1;
      }
    }
    return inserted;
  })();
}

/**
 * Refresh flags for messages already stored.
 *
 * DayDesk never writes flags to the server, but it does read them, so changes
 * made in Yahoo Mail elsewhere are reflected here on the next reconcile.
 */
export function updateFlags(
  db: Database,
  folderId: number,
  updates: readonly { uid: number; flags: readonly string[] }[],
): number {
  const statement = db.prepare(
    `UPDATE messages
     SET flags_json = ?, is_seen = ?, is_flagged = ?
     WHERE folder_id = ? AND uid = ?`,
  );

  return db.transaction(() => {
    let changed = 0;
    for (const update of updates) {
      const result = statement.run(
        JSON.stringify(update.flags),
        update.flags.includes('\\Seen') ? 1 : 0,
        update.flags.includes('\\Flagged') ? 1 : 0,
        folderId,
        update.uid,
      );
      changed += result.changes;
    }
    return changed;
  })();
}

export function deleteByUids(db: Database, folderId: number, uids: readonly number[]): number {
  if (uids.length === 0) return 0;

  const selectId = db.prepare('SELECT id FROM messages WHERE folder_id = ? AND uid = ?');
  const deleteFts = db.prepare('DELETE FROM messages_fts WHERE rowid = ?');
  const deleteMessage = db.prepare('DELETE FROM messages WHERE folder_id = ? AND uid = ?');

  return db.transaction(() => {
    let removed = 0;
    for (const uid of uids) {
      const row = selectId.get(folderId, uid) as { id: number } | undefined;
      if (!row) continue;
      deleteFts.run(row.id);
      removed += deleteMessage.run(folderId, uid).changes;
    }
    return removed;
  })();
}

export function listUids(db: Database, folderId: number): readonly number[] {
  const rows = db
    .prepare('SELECT uid FROM messages WHERE folder_id = ? ORDER BY uid')
    .all(folderId) as { uid: number }[];
  return rows.map((row) => row.uid);
}

export function countMessages(db: Database, folderId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE folder_id = ?').get(folderId) as {
    n: number;
  };
  return row.n;
}

export function maxUid(db: Database, folderId: number): number | null {
  const row = db.prepare('SELECT MAX(uid) AS u FROM messages WHERE folder_id = ?').get(folderId) as {
    u: number | null;
  };
  return row.u;
}

export interface ListPage {
  readonly messages: readonly MessageSummary[];
  readonly total: number;
}

export function listMessages(
  db: Database,
  folderId: number,
  role: FolderRole,
  options: { limit: number; offset: number; unreadOnly?: boolean },
): ListPage {
  const where = options.unreadOnly ? 'folder_id = ? AND is_seen = 0' : 'folder_id = ?';

  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE ${where}
       ORDER BY internal_date DESC, uid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(folderId, options.limit, options.offset) as MessageRow[];

  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE ${where}`).get(folderId) as {
    n: number;
  };

  return { messages: rows.map((row) => rowToSummary(row, role)), total: n };
}

export function getMessageById(db: Database, id: number): (MessageRow & { role: FolderRole }) | null {
  return (
    (db
      .prepare(
        `SELECT messages.*, folders.role AS role
         FROM messages JOIN folders ON folders.id = messages.folder_id
         WHERE messages.id = ?`,
      )
      .get(id) as (MessageRow & { role: FolderRole }) | undefined) ?? null
  );
}

export interface StoredBody {
  readonly body_text: string | null;
  readonly body_html: string | null;
  readonly fetched_at: string;
}

export function getBody(db: Database, messageId: number): StoredBody | null {
  return (
    (db.prepare('SELECT * FROM message_bodies WHERE message_id = ?').get(messageId) as
      | StoredBody
      | undefined) ?? null
  );
}

/** Persist a fetched body and fold its text into the full-text index. */
export function saveBody(
  db: Database,
  messageId: number,
  body: { text: string | null; html: string | null },
): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO message_bodies (message_id, body_text, body_html, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (message_id) DO UPDATE SET
         body_text = excluded.body_text,
         body_html = excluded.body_html,
         fetched_at = excluded.fetched_at`,
    ).run(messageId, body.text, body.html, new Date().toISOString());

    // FTS5 rows are not updatable in place; delete and reinsert.
    const header = db.prepare('SELECT subject, from_name, from_addr FROM messages WHERE id = ?').get(
      messageId,
    ) as { subject: string; from_name: string; from_addr: string } | undefined;
    if (!header) return;

    const sender = [header.from_name, header.from_addr].filter(Boolean).join(' ');
    db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(messageId);
    db.prepare('INSERT INTO messages_fts (rowid, subject, sender, body) VALUES (?, ?, ?, ?)').run(
      messageId,
      header.subject,
      sender,
      body.text ?? '',
    );
  })();
}

export function saveAttachments(
  db: Database,
  messageId: number,
  attachments: readonly { filename: string; contentType: string; size: number; contentId: string | null }[],
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM attachments WHERE message_id = ?').run(messageId);
    const statement = db.prepare(
      `INSERT INTO attachments (message_id, filename, content_type, size, content_id)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const attachment of attachments) {
      statement.run(
        messageId,
        attachment.filename,
        attachment.contentType,
        attachment.size,
        attachment.contentId,
      );
    }
  })();
}

export function listAttachments(db: Database, messageId: number): MessageDetail['attachments'] {
  const rows = db
    .prepare('SELECT id, filename, content_type, size FROM attachments WHERE message_id = ? ORDER BY id')
    .all(messageId) as { id: number; filename: string; content_type: string; size: number }[];

  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
  }));
}
