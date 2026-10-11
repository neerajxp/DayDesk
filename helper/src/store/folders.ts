import type { Database } from 'better-sqlite3';
import type { FolderRole } from '../types/mail.js';

export interface FolderRow {
  readonly id: number;
  readonly account_id: number;
  readonly role: FolderRole;
  readonly path: string;
  /**
   * Stored as TEXT because IMAP UIDVALIDITY is a 32-bit unsigned value that
   * imapflow surfaces as a BigInt; stringifying avoids precision surprises.
   */
  readonly uid_validity: string | null;
  readonly uid_next: number | null;
  readonly highest_modseq: string | null;
  readonly floor_uid: number | null;
  readonly floor_date: string | null;
  readonly last_sync_at: string | null;
}

export function upsertFolder(
  db: Database,
  accountId: number,
  role: FolderRole,
  path: string,
): FolderRow {
  db.prepare(
    `INSERT INTO folders (account_id, role, path)
     VALUES (?, ?, ?)
     ON CONFLICT (account_id, role) DO UPDATE SET path = excluded.path`,
  ).run(accountId, role, path);

  return getFolder(db, accountId, role)!;
}

export function getFolder(db: Database, accountId: number, role: FolderRole): FolderRow | null {
  return (
    (db
      .prepare('SELECT * FROM folders WHERE account_id = ? AND role = ?')
      .get(accountId, role) as FolderRow | undefined) ?? null
  );
}

export function listFolders(db: Database, accountId: number): readonly FolderRow[] {
  return db.prepare('SELECT * FROM folders WHERE account_id = ? ORDER BY role').all(accountId) as FolderRow[];
}

/**
 * Record the floor — the oldest message DayDesk will ever hold for this folder.
 *
 * Both UID and date are stored. The UID is the natural key, but if the server
 * ever bumps UIDVALIDITY every UID in the folder is invalidated, and a UID-only
 * anchor becomes meaningless. The date survives that and lets us re-anchor.
 */
export function setFloor(db: Database, folderId: number, floorUid: number, floorDate: string): void {
  db.prepare('UPDATE folders SET floor_uid = ?, floor_date = ? WHERE id = ?').run(
    floorUid,
    floorDate,
    folderId,
  );
}

export function setSyncState(
  db: Database,
  folderId: number,
  state: { uidValidity: string; uidNext: number | null; highestModseq: string | null },
): void {
  db.prepare(
    `UPDATE folders
     SET uid_validity = ?, uid_next = ?, highest_modseq = ?, last_sync_at = ?
     WHERE id = ?`,
  ).run(state.uidValidity, state.uidNext, state.highestModseq, new Date().toISOString(), folderId);
}

/**
 * Drop every message in a folder, used when UIDVALIDITY changes and the local
 * UID map is no longer meaningful. Keeps the folder row and its floor_date so
 * the window can be re-anchored by date.
 */
export function clearFolderMessages(db: Database, folderId: number): number {
  return db.transaction(() => {
    const ids = db.prepare('SELECT id FROM messages WHERE folder_id = ?').all(folderId) as { id: number }[];
    for (const { id } of ids) {
      db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(id);
    }
    const result = db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folderId);
    db.prepare('UPDATE folders SET floor_uid = NULL, uid_next = NULL, highest_modseq = NULL WHERE id = ?').run(
      folderId,
    );
    return result.changes;
  })();
}
