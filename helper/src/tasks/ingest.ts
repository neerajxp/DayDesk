/**
 * The one door every email and chat message goes through on its way to the
 * Today board. This is where mail and WhatsApp become a single to-do list:
 *
 *   1. Already handled this item?        → refine its own task, nothing else.
 *   2. Already on another task's trail?  → leave it there.
 *   3. A task, and an open task matches? → follow-up: attach, don't duplicate.
 *   4. A task, no match?                 → new task.
 *   5. Not a task, but talks about one?  → mention, or a "looks done" hint.
 */

import type { Database } from 'better-sqlite3';
import type { TaskCandidate } from '../types/tasks.js';
import * as tasksStore from '../store/tasks.js';
import { findRelated, looksDone } from './correlate.js';
import { addDays } from './dates.js';

/** Only tasks this recent are candidates for merging — old work is old news. */
const CORRELATION_WINDOW_DAYS = 45;

export interface IngestInput {
  readonly candidates: readonly TaskCandidate[];
  /** The item's readable text (subject + body, or the chat message). */
  readonly text: string;
  readonly now: Date;
}

export interface IngestResult {
  readonly added: readonly TaskCandidate[];
  readonly linked: number;
}

export function ingest(
  db: Database,
  accountId: number,
  origin: tasksStore.TaskOrigin,
  input: IngestInput,
): IngestResult {
  return db.transaction((): IngestResult => {
    const own = input.candidates.filter((candidate) => tasksStore.hasOwnTask(db, origin, candidate.kind));
    if (own.length > 0) {
      tasksStore.saveRuleTasks(db, accountId, origin, own);
      return { added: [], linked: 0 };
    }
    // Merged into another task earlier; recreating it now would split the trail
    // (or revive work that has since been ticked off).
    if (tasksStore.isLinked(db, origin)) return { added: [], linked: 0 };

    const profiles = tasksStore.listOpenProfiles(db, accountId, {
      sinceIso: addDays(input.now, -CORRELATION_WINDOW_DAYS).toISOString(),
      excluding: origin,
    });

    const fresh: TaskCandidate[] = [];
    let linked = 0;
    for (const candidate of input.candidates) {
      const match = findRelated({ ...candidate, text: input.text }, profiles, 'followup');
      if (!match) {
        fresh.push(candidate);
        continue;
      }
      if (tasksStore.addTaskLink(db, match.taskId, origin, 'followup')) linked += 1;
      tasksStore.fillDueDate(db, match.taskId, candidate.dueDate);
    }

    if (input.candidates.length === 0) {
      const isDone = looksDone(input.text);
      const evidence = { kind: null, title: '', amount: null, text: input.text };
      const match = findRelated(evidence, profiles, isDone ? 'done' : 'mention');
      if (match && tasksStore.addTaskLink(db, match.taskId, origin, isDone ? 'done-hint' : 'mention')) linked += 1;
    }

    const added = fresh.length > 0 ? tasksStore.saveRuleTasks(db, accountId, origin, fresh) : [];
    return { added, linked };
  })();
}
