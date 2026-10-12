/**
 * Runs the rules engine over recent inbox mail and stores what it finds.
 *
 * Database-only — the caller decides when bodies get fetched. Safe to call as
 * often as you like: each message is scanned once on headers, once more when
 * its body arrives, and again whenever RULES_VERSION goes up.
 */

import type { Database } from 'better-sqlite3';
import * as tasksStore from '../store/tasks.js';
import { extractTasks, RULES_VERSION } from './extract.js';
import { ingest } from './ingest.js';
import { addDays } from './dates.js';

export interface ScanResult {
  readonly scanned: number;
  readonly added: number;
  /** Items attached to an existing task's trail instead of becoming new tasks. */
  readonly linked: number;
  readonly firstTitle: string | null;
}

export function scanWindowStart(now: Date, windowDays: number): string {
  return addDays(now, -windowDays).toISOString();
}

export function scanForTasks(db: Database, accountId: number, options: { now: Date; windowDays: number }): ScanResult {
  const targets = tasksStore.listScanTargets(
    db,
    accountId,
    scanWindowStart(options.now, options.windowDays),
    RULES_VERSION,
  );

  let added = 0;
  let linked = 0;
  let firstTitle: string | null = null;

  for (const target of targets) {
    const candidates = extractTasks({
      subject: target.subject,
      fromName: target.fromName,
      fromAddress: target.fromAddress,
      bodyText: target.bodyText,
      receivedAt: new Date(target.receivedAt),
    });
    const result = ingest(db, accountId, { messageId: target.id }, {
      candidates,
      text: `${target.subject}\n${target.bodyText ?? ''}`,
      now: options.now,
    });
    tasksStore.markScanned(db, target.id, target.hasBody, RULES_VERSION);

    added += result.added.length;
    linked += result.linked;
    firstTitle ??= result.added[0]?.title ?? null;
  }

  return { scanned: targets.length, added, linked, firstTitle };
}
