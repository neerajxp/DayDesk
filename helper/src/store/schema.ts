/**
 * Database schema and forward migrations.
 *
 * Versioned via SQLite's user_version. Each migration is applied in order
 * inside a transaction, so a partially-applied schema is not a reachable state.
 *
 * Design notes:
 *  - `accounts` exists even though V1 only ever holds one row. Adding an
 *    account foreign key to a populated messages table later is a painful
 *    migration; designing it in now is free.
 *  - Bodies live in a separate table because they arrive lazily, long after
 *    the header row, and most rows never get one.
 *  - Attachments are referenced by disk path, never stored as blobs — blobs
 *    bloat the database badly and make it slow to copy or back up.
 */

import type { Database } from 'better-sqlite3';

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial',
    up: `
      CREATE TABLE accounts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT    NOT NULL UNIQUE,
        provider_id TEXT    NOT NULL,
        created_at  TEXT    NOT NULL
      );

      CREATE TABLE folders (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        role            TEXT    NOT NULL CHECK (role IN ('inbox','sent')),
        path            TEXT    NOT NULL,
        uid_validity    TEXT,
        uid_next        INTEGER,
        highest_modseq  TEXT,
        floor_uid       INTEGER,
        floor_date      TEXT,
        last_sync_at    TEXT,
        UNIQUE (account_id, role)
      );

      CREATE TABLE messages (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id        INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        uid              INTEGER NOT NULL,
        message_id       TEXT,
        subject          TEXT    NOT NULL DEFAULT '',
        from_name        TEXT    NOT NULL DEFAULT '',
        from_addr        TEXT    NOT NULL DEFAULT '',
        to_json          TEXT    NOT NULL DEFAULT '[]',
        cc_json          TEXT    NOT NULL DEFAULT '[]',
        date             TEXT,
        internal_date    TEXT    NOT NULL,
        size             INTEGER NOT NULL DEFAULT 0,
        flags_json       TEXT    NOT NULL DEFAULT '[]',
        is_seen          INTEGER NOT NULL DEFAULT 0,
        is_flagged       INTEGER NOT NULL DEFAULT 0,
        has_attachments  INTEGER NOT NULL DEFAULT 0,
        snippet          TEXT    NOT NULL DEFAULT '',
        UNIQUE (folder_id, uid)
      );

      CREATE INDEX idx_messages_folder_date ON messages (folder_id, internal_date DESC);
      CREATE INDEX idx_messages_message_id  ON messages (message_id);

      CREATE TABLE message_bodies (
        message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        body_text  TEXT,
        body_html  TEXT,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE attachments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id   INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        filename     TEXT    NOT NULL,
        content_type TEXT    NOT NULL DEFAULT 'application/octet-stream',
        size         INTEGER NOT NULL DEFAULT 0,
        disk_path    TEXT,
        content_id   TEXT
      );

      CREATE INDEX idx_attachments_message ON attachments (message_id);

      -- Full-text index. rowid is kept equal to messages.id so search results
      -- join straight back to the header row. Populated from application code
      -- rather than triggers, because bodies arrive lazily and need an update
      -- long after the header row is inserted.
      CREATE VIRTUAL TABLE messages_fts USING fts5 (
        subject,
        sender,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/** Apply any migrations the database has not yet seen. Safe on every startup. */
export function migrate(db: Database): { from: number; to: number; applied: string[] } {
  const from = db.pragma('user_version', { simple: true }) as number;
  const applied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;

    db.transaction(() => {
      db.exec(migration.up);
      // pragma can't be parameterised; version is a trusted integer literal.
      db.pragma(`user_version = ${migration.version}`);
    })();

    applied.push(migration.name);
  }

  return { from, to: LATEST_SCHEMA_VERSION, applied };
}
