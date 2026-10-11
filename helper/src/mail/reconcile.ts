/**
 * Reconciliation between local state and the server.
 *
 * Naive "fetch anything with a UID above my high-water mark" sync misses two
 * whole classes of change: messages deleted on the server, and flag changes
 * (read/unread, starred) made in Yahoo Mail elsewhere. Both show up as stale
 * rows that never correct themselves. These functions compute the deltas.
 *
 * Pure functions only. No IMAP, no database.
 */

export interface UidDiff {
  /** On the server, not stored locally. */
  readonly added: readonly number[];
  /** Stored locally, no longer on the server — deleted or moved elsewhere. */
  readonly removed: readonly number[];
}

/**
 * Diff local UIDs against the server's, scoped to at-or-above the floor.
 *
 * The floor scoping matters: local UIDs below the floor shouldn't exist, and
 * server UIDs below it are deliberately out of scope, so neither should be
 * reported as a difference.
 */
export function diffUids(
  localUids: readonly number[],
  serverUids: readonly number[],
  floorUid: number | null,
): UidDiff {
  const floor = floorUid ?? Number.NEGATIVE_INFINITY;

  const local = new Set(localUids.filter((uid) => uid >= floor));
  const server = new Set(serverUids.filter((uid) => uid >= floor));

  const added: number[] = [];
  for (const uid of server) {
    if (!local.has(uid)) added.push(uid);
  }

  const removed: number[] = [];
  for (const uid of local) {
    if (!server.has(uid)) removed.push(uid);
  }

  return {
    added: added.sort((a, b) => a - b),
    removed: removed.sort((a, b) => a - b),
  };
}

export interface FlagChange {
  readonly uid: number;
  readonly flags: readonly string[];
}

/**
 * Keep only genuinely changed flag sets, so a reconcile pass over a thousand
 * unchanged messages issues no writes.
 *
 * Compares as order-insensitive sets, because servers are free to return flags
 * in any order and a reordering is not a change.
 */
export function changedFlags(
  local: ReadonlyMap<number, readonly string[]>,
  server: readonly FlagChange[],
): readonly FlagChange[] {
  return server.filter((entry) => {
    const existing = local.get(entry.uid);
    if (!existing) return false; // Not stored yet; the insert path will handle it.
    return !sameFlagSet(existing, entry.flags);
  });
}

function sameFlagSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  for (const flag of b) {
    if (!left.has(flag)) return false;
  }
  return true;
}

/**
 * Decide whether the server's UIDs still mean what our stored UIDs mean.
 *
 * A changed UIDVALIDITY invalidates every UID in the mailbox. Carrying on as if
 * nothing happened silently corrupts the archive — rows get attributed to the
 * wrong messages — so this is checked before every sync, not just the first.
 */
export function isUidMapStillValid(
  storedUidValidity: string | null,
  serverUidValidity: string,
): boolean {
  if (storedUidValidity === null) return true; // Nothing stored yet; nothing to invalidate.
  return storedUidValidity === serverUidValidity;
}
