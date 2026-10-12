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
  {
    version: 2,
    name: 'tasks',
    // Tasks outlive their email: if a message rolls off the server the task
    // stays, it just loses its link (ON DELETE SET NULL).
    //
    // UNIQUE (message_id, kind) is what makes re-scanning idempotent — a rule
    // that fires again on the same email cannot resurrect a task the user
    // already ticked off or dismissed. SQLite treats NULLs as distinct, so
    // manual tasks (no message) are unaffected.
    up: `
      CREATE TABLE tasks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        message_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        kind        TEXT    NOT NULL CHECK (kind IN ('pay','sign','cheque','reply','deadline','todo')),
        title       TEXT    NOT NULL,
        due_date    TEXT,
        amount      TEXT,
        status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
        source      TEXT    NOT NULL CHECK (source IN ('rule','manual')),
        created_at  TEXT    NOT NULL,
        done_at     TEXT,
        UNIQUE (message_id, kind)
      );

      CREATE INDEX idx_tasks_status_due ON tasks (account_id, status, due_date);

      -- Which messages the rules engine has already looked at, and whether it
      -- saw the body. A message scanned on headers alone is rescanned once its
      -- body arrives.
      CREATE TABLE task_scans (
        message_id  INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        had_body    INTEGER NOT NULL,
        scanned_at  TEXT    NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: 'task-rules-version',
    // Existing scans are stamped version 1, so the first start after an
    // upgrade rescans them with the current rules.
    up: `
      ALTER TABLE task_scans ADD COLUMN rules_version INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 4,
    name: 'chat-messages',
    // Messages from watched WhatsApp chats. Only watched chats ever arrive —
    // the WhatsApp tab filters before sending.
    //
    // ext_key is a content hash (chat + day + text), not WhatsApp's message
    // id: the same message can reach us first as a chat-list preview and later
    // from the open conversation, and both must collapse into one row.
    up: `
      CREATE TABLE chat_messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        source       TEXT    NOT NULL CHECK (source IN ('whatsapp')),
        ext_key      TEXT    NOT NULL,
        chat_name    TEXT    NOT NULL,
        sender       TEXT    NOT NULL DEFAULT '',
        text         TEXT    NOT NULL,
        is_from_me   INTEGER NOT NULL DEFAULT 0,
        sent_at      TEXT    NOT NULL,
        received_at  TEXT    NOT NULL,
        UNIQUE (source, ext_key)
      );

      ALTER TABLE tasks ADD COLUMN chat_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL;
      CREATE UNIQUE INDEX idx_tasks_chat_kind ON tasks (chat_message_id, kind);
    `,
  },
  {
    version: 5,
    name: 'task-links',
    // The trail behind a task: other emails and chat messages about the same
    // work. A task still has exactly one origin (tasks.message_id or
    // tasks.chat_message_id); links are everything that came after.
    up: `
      CREATE TABLE task_links (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        message_id       INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        chat_message_id  INTEGER REFERENCES chat_messages(id) ON DELETE CASCADE,
        relation         TEXT    NOT NULL CHECK (relation IN ('followup','mention','done-hint')),
        created_at       TEXT    NOT NULL,
        CHECK ((message_id IS NULL) <> (chat_message_id IS NULL))
      );

      CREATE UNIQUE INDEX idx_task_links_message ON task_links (task_id, message_id) WHERE message_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_task_links_chat ON task_links (task_id, chat_message_id) WHERE chat_message_id IS NOT NULL;
      CREATE INDEX idx_task_links_task ON task_links (task_id);
    `,
  },
  {
    version: 6,
    name: 'chat-rules-version',
    // Which version of the chat rules last read each message. Existing rows
    // start at 1, so the first start after an upgrade re-reads recent chat
    // with the current rules — a message missed by older rules is not lost.
    up: `
      ALTER TABLE chat_messages ADD COLUMN rules_version INTEGER NOT NULL DEFAULT 1;
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
