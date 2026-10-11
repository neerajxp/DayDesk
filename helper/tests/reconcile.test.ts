import { describe, expect, test } from 'vitest';
import { changedFlags, diffUids, isUidMapStillValid } from '../src/mail/reconcile.js';

describe('diffUids', () => {
  test('reports uids the server has that we do not', () => {
    const result = diffUids([1, 2], [1, 2, 3], null);

    expect(result.added).toEqual([3]);
    expect(result.removed).toEqual([]);
  });

  test('reports uids we have that the server no longer does', () => {
    const result = diffUids([1, 2, 3], [1, 3], null);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([2]);
  });

  test('ignores uids below the floor on both sides', () => {
    // 1 and 2 are deliberately out of scope; neither should be reported.
    const result = diffUids([2, 10, 11], [1, 10, 12], 10);

    expect(result.added).toEqual([12]);
    expect(result.removed).toEqual([11]);
  });

  test('treats a uid exactly at the floor as in scope', () => {
    const result = diffUids([], [10], 10);

    expect(result.added).toEqual([10]);
  });

  test('reports nothing when local and server agree', () => {
    const result = diffUids([5, 6, 7], [7, 6, 5], null);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});

describe('changedFlags', () => {
  test('reports a message that became read', () => {
    const local = new Map([[1, [] as readonly string[]]]);

    const result = changedFlags(local, [{ uid: 1, flags: ['\\Seen'] }]);

    expect(result).toEqual([{ uid: 1, flags: ['\\Seen'] }]);
  });

  test('ignores a reordered flag set, which is not a change', () => {
    const local = new Map([[1, ['\\Seen', '\\Flagged'] as readonly string[]]]);

    const result = changedFlags(local, [{ uid: 1, flags: ['\\Flagged', '\\Seen'] }]);

    expect(result).toEqual([]);
  });

  test('ignores uids that are not stored locally', () => {
    const local = new Map<number, readonly string[]>();

    const result = changedFlags(local, [{ uid: 99, flags: ['\\Seen'] }]);

    expect(result).toEqual([]);
  });

  test('reports a message that lost a flag', () => {
    const local = new Map([[1, ['\\Seen'] as readonly string[]]]);

    const result = changedFlags(local, [{ uid: 1, flags: [] }]);

    expect(result).toEqual([{ uid: 1, flags: [] }]);
  });
});

describe('isUidMapStillValid', () => {
  test('is valid when uidvalidity is unchanged', () => {
    expect(isUidMapStillValid('12345', '12345')).toBe(true);
  });

  test('is invalid when uidvalidity changed — every stored uid is now meaningless', () => {
    expect(isUidMapStillValid('12345', '67890')).toBe(false);
  });

  test('is valid when nothing is stored yet', () => {
    expect(isUidMapStillValid(null, '12345')).toBe(true);
  });
});
