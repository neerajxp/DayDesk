/**
 * Floor anchoring.
 *
 * DayDesk syncs the newest N messages on a folder's first pass and then never
 * backfills below that point — the "floor". Everything above the floor is kept
 * permanently, so the archive grows forward without bound and nothing is ever
 * evicted. Raising the configured backlog later lowers the floor on the next
 * sync; it never raises it.
 *
 * Pure functions only. No IMAP, no database.
 */

export interface FloorSelection {
  /** UIDs to fetch, ascending. */
  readonly uids: readonly number[];
  /** The lowest UID in the selection — the new floor. */
  readonly floorUid: number;
  /** How many messages the server reported, before the window was applied. */
  readonly availableCount: number;
  /** True when the folder held more messages than the backlog window. */
  readonly truncated: boolean;
}

/**
 * Select the newest `backlog` UIDs from a server-reported UID list.
 *
 * IMAP SEARCH returns UIDs in ascending order, so the newest are at the tail.
 * The input is sorted defensively rather than trusted, because a malformed or
 * reordered response would otherwise silently anchor the floor in the wrong
 * place and permanently truncate the archive.
 */
export function selectInitialWindow(
  serverUids: readonly number[],
  backlog: number,
): FloorSelection | null {
  if (serverUids.length === 0 || backlog <= 0) return null;

  const ascending = [...serverUids].sort((a, b) => a - b);
  const window = ascending.slice(Math.max(0, ascending.length - backlog));
  const floorUid = window[0]!;

  return {
    uids: window,
    floorUid,
    availableCount: ascending.length,
    truncated: ascending.length > window.length,
  };
}

/**
 * Select UIDs to fetch on an incremental pass: anything above the highest UID
 * already stored locally.
 *
 * Deliberately ignores the floor. A message with a UID above our high-water
 * mark is new mail by definition, and new mail is always in scope.
 */
export function selectNewUids(
  serverUids: readonly number[],
  highestStoredUid: number | null,
): readonly number[] {
  if (highestStoredUid === null) return [...serverUids].sort((a, b) => a - b);
  return serverUids.filter((uid) => uid > highestStoredUid).sort((a, b) => a - b);
}

/**
 * Extend an existing window downward after the configured backlog is raised.
 *
 * Returns the UIDs between the new, deeper floor and the current one. Returns
 * an empty list when the backlog shrank or is unchanged — the floor never rises,
 * because that would mean discarding mail DayDesk had already archived.
 */
export function selectBackfillUids(
  serverUids: readonly number[],
  currentFloorUid: number,
  backlog: number,
): readonly number[] {
  const ascending = [...serverUids].sort((a, b) => a - b);
  const window = ascending.slice(Math.max(0, ascending.length - backlog));
  return window.filter((uid) => uid < currentFloorUid);
}

/** Split a UID list into batches for FETCH, preserving order. */
export function batchUids(uids: readonly number[], batchSize: number): readonly (readonly number[])[] {
  if (batchSize <= 0) throw new Error('batchSize must be positive');

  const batches: number[][] = [];
  for (let index = 0; index < uids.length; index += batchSize) {
    batches.push(uids.slice(index, index + batchSize));
  }
  return batches;
}
