/**
 * Database handle and lifecycle.
 */

import BetterSqlite3, { type Database } from 'better-sqlite3';
import { PATHS, ensureDirectories } from '../config/paths.js';
import { migrate } from './schema.js';

let handle: Database | null = null;

export function openDatabase(filename: string = PATHS.database): Database {
  if (handle) return handle;

  if (filename !== ':memory:') ensureDirectories();

  const db = new BetterSqlite3(filename);

  // WAL keeps the sync writer from blocking panel reads.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  handle = db;
  return db;
}

export function getDatabase(): Database {
  if (!handle) throw new Error('Database not opened. Call openDatabase() during startup.');
  return handle;
}

export function closeDatabase(): void {
  handle?.close();
  handle = null;
}

/** Test seam: an isolated in-memory database with the schema applied. */
export function createTestDatabase(): Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
