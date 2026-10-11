import type { Database } from 'better-sqlite3';

export interface AccountRow {
  readonly id: number;
  readonly email: string;
  readonly provider_id: string;
  readonly created_at: string;
}

/**
 * Create or replace the single DayDesk account.
 *
 * V1 is deliberately single-account at the API level even though the schema
 * supports many. Re-pairing with a different address replaces the old account,
 * cascading its folders and messages away.
 */
export function upsertAccount(db: Database, email: string, providerId: string): AccountRow {
  return db.transaction(() => {
    db.prepare('DELETE FROM accounts WHERE email != ?').run(email);
    db.prepare(
      `INSERT INTO accounts (email, provider_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET provider_id = excluded.provider_id`,
    ).run(email, providerId, new Date().toISOString());

    const row = db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as AccountRow;
    return row;
  })();
}

export function getAccount(db: Database): AccountRow | null {
  return (db.prepare('SELECT * FROM accounts ORDER BY id LIMIT 1').get() as AccountRow | undefined) ?? null;
}

export function deleteAccount(db: Database, email: string): void {
  db.prepare('DELETE FROM accounts WHERE email = ?').run(email);
}
