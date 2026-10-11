import { describe, expect, test } from 'vitest';
import {
  batchUids,
  selectBackfillUids,
  selectInitialWindow,
  selectNewUids,
} from '../src/mail/anchor.js';

describe('selectInitialWindow', () => {
  test('takes the newest N uids when the folder is larger than the backlog', () => {
    const uids = Array.from({ length: 2500 }, (_, index) => index + 1);

    const result = selectInitialWindow(uids, 1000);

    expect(result).not.toBeNull();
    expect(result!.uids).toHaveLength(1000);
    expect(result!.floorUid).toBe(1501);
    expect(result!.uids.at(-1)).toBe(2500);
    expect(result!.truncated).toBe(true);
    expect(result!.availableCount).toBe(2500);
  });

  test('takes everything when the folder is smaller than the backlog', () => {
    const result = selectInitialWindow([4, 9, 11], 1000);

    expect(result!.uids).toEqual([4, 9, 11]);
    expect(result!.floorUid).toBe(4);
    expect(result!.truncated).toBe(false);
  });

  test('sorts defensively rather than trusting server ordering', () => {
    // A reordered SEARCH response would otherwise anchor the floor at the wrong
    // uid and permanently truncate the archive.
    const result = selectInitialWindow([50, 10, 30, 20, 40], 3);

    expect(result!.uids).toEqual([30, 40, 50]);
    expect(result!.floorUid).toBe(30);
  });

  test('returns null for an empty mailbox', () => {
    expect(selectInitialWindow([], 1000)).toBeNull();
  });

  test('returns null when the backlog is not positive', () => {
    expect(selectInitialWindow([1, 2, 3], 0)).toBeNull();
    expect(selectInitialWindow([1, 2, 3], -5)).toBeNull();
  });
});

describe('selectNewUids', () => {
  test('returns only uids above the local high-water mark', () => {
    expect(selectNewUids([1, 2, 3, 4, 5], 3)).toEqual([4, 5]);
  });

  test('returns everything when nothing is stored yet', () => {
    expect(selectNewUids([3, 1, 2], null)).toEqual([1, 2, 3]);
  });

  test('returns nothing when the server has no new mail', () => {
    expect(selectNewUids([1, 2, 3], 3)).toEqual([]);
  });

  test('ignores the floor, because new mail is always in scope', () => {
    expect(selectNewUids([100, 200, 300], 150)).toEqual([200, 300]);
  });
});

describe('selectBackfillUids', () => {
  test('returns uids between a deepened floor and the current one', () => {
    const uids = Array.from({ length: 100 }, (_, index) => index + 1);

    // Floor is currently 51 (newest 50). Backlog raised to 70.
    const result = selectBackfillUids(uids, 51, 70);

    expect(result).toEqual(Array.from({ length: 20 }, (_, index) => index + 31));
  });

  test('returns nothing when the backlog shrank — the floor never rises', () => {
    const uids = Array.from({ length: 100 }, (_, index) => index + 1);

    expect(selectBackfillUids(uids, 51, 10)).toEqual([]);
  });

  test('returns nothing when the backlog is unchanged', () => {
    const uids = Array.from({ length: 100 }, (_, index) => index + 1);

    expect(selectBackfillUids(uids, 51, 50)).toEqual([]);
  });
});

describe('batchUids', () => {
  test('splits into batches preserving order', () => {
    expect(batchUids([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('returns no batches for an empty list', () => {
    expect(batchUids([], 100)).toEqual([]);
  });

  test('rejects a non-positive batch size rather than looping forever', () => {
    expect(() => batchUids([1, 2], 0)).toThrow(/batchSize must be positive/);
  });
});
