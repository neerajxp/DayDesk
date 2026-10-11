/**
 * Filesystem layout for DayDesk's local state.
 *
 * Everything lives under ~/.daydesk so it is trivial to inspect, back up, or
 * delete wholesale. The app password is the one thing that is NOT here — it
 * lives in the macOS Keychain (see src/secrets/keychain.ts).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const DAYDESK_HOME = process.env.DAYDESK_HOME ?? join(homedir(), '.daydesk');

export const PATHS = {
  home: DAYDESK_HOME,
  database: join(DAYDESK_HOME, 'daydesk.db'),
  token: join(DAYDESK_HOME, 'token'),
  config: join(DAYDESK_HOME, 'config.json'),
  attachments: join(DAYDESK_HOME, 'attachments'),
  logs: join(DAYDESK_HOME, 'logs'),
} as const;

/** Create the state directories. Idempotent, safe on every startup. */
export function ensureDirectories(): void {
  // 0o700 — this directory holds your mail archive. Owner-only, always.
  mkdirSync(PATHS.home, { recursive: true, mode: 0o700 });
  mkdirSync(PATHS.attachments, { recursive: true, mode: 0o700 });
  mkdirSync(PATHS.logs, { recursive: true, mode: 0o700 });
}
