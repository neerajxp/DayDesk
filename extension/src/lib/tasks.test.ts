import { describe, expect, test } from 'vitest';
import type { Task } from './api/types.js';
import {
  daySummary,
  bucketOf,
  doneHintOf,
  dueLabel,
  formatTrailTime,
  groupTasks,
  originOf,
  parseQuickAdd,
  sourcesOf,
} from './tasks.js';

const TODAY = '2026-10-10'; // Saturday
const SATURDAY = new Date(2026, 9, 10, 9, 0, 0);

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    kind: 'todo',
    title: 'Thing',
    dueDate: null,
    amount: null,
    status: 'open',
    source: 'manual',
    createdAt: '2026-10-01T00:00:00.000Z',
    doneAt: null,
    message: null,
    chat: null,
    related: [],
    ...overrides,
  };
}

describe('bucketOf', () => {
  test.each([
    ['2026-10-09', 'overdue'],
    ['2026-10-10', 'today'],
    ['2026-10-11', 'week'],
    ['2026-10-17', 'week'],
    ['2026-10-18', 'later'],
    [null, 'whenever'],
  ] as const)('due %s → %s', (dueDate, bucket) => {
    expect(bucketOf(task({ dueDate }), TODAY)).toBe(bucket);
  });

  test('done wins over any date', () => {
    expect(bucketOf(task({ dueDate: '2026-10-01', status: 'done' }), TODAY)).toBe('done');
  });
});

test('groupTasks keeps server order within a bucket', () => {
  const groups = groupTasks(
    [task({ id: 1, dueDate: '2026-10-12' }), task({ id: 2 }), task({ id: 3, dueDate: '2026-10-13' })],
    TODAY,
  );
  expect(groups.get('week')?.map((t) => t.id)).toEqual([1, 3]);
  expect(groups.get('whenever')?.map((t) => t.id)).toEqual([2]);
});

describe('dueLabel', () => {
  test('speaks relatively near today', () => {
    expect(dueLabel('2026-10-07', TODAY)).toBe('3 days overdue');
    expect(dueLabel('2026-10-09', TODAY)).toBe('Due yesterday');
    expect(dueLabel('2026-10-10', TODAY)).toBe('Due today');
    expect(dueLabel('2026-10-11', TODAY)).toBe('Tomorrow');
    expect(dueLabel(null, TODAY)).toBeNull();
  });
});

describe('daySummary', () => {
  test('leads with what is due today, flagging anything overdue beside it', () => {
    expect(
      daySummary(
        [
          task({ kind: 'pay', dueDate: '2026-10-09' }),
          task({ kind: 'pay', dueDate: '2026-10-10' }),
          task({ kind: 'sign', dueDate: '2026-10-10' }),
          task({ kind: 'todo', dueDate: '2026-12-01' }),
        ],
        TODAY,
      ),
    ).toEqual({
      headline: '2 due today',
      overdueChip: 1,
      tone: 'due',
      detail: { label: 'This week', text: '2 bills to pay · 1 to sign' },
    });
  });

  test('when nothing is due today, overdue work takes the headline', () => {
    expect(daySummary([task({ dueDate: '2026-10-08' }), task({ dueDate: '2026-10-09' })], TODAY)).toMatchObject({
      headline: '2 overdue',
      overdueChip: 0,
      tone: 'overdue',
    });
  });

  test('a clear today still mentions what this week holds', () => {
    expect(daySummary([task({ kind: 'reply', dueDate: '2026-10-12' })], TODAY)).toEqual({
      headline: 'Nothing due today',
      overdueChip: 0,
      tone: 'clear',
      detail: { label: 'This week', text: '1 reply owed' },
    });
  });

  test('an open task with no date (or a later one) is acknowledged, not ignored', () => {
    expect(daySummary([task({ kind: 'pay', dueDate: null })], TODAY)).toEqual({
      headline: 'Nothing due today',
      overdueChip: 0,
      tone: 'clear',
      detail: { label: 'Still open', text: '1 bill to pay' },
    });
    expect(daySummary([task({ dueDate: '2026-12-01' })], TODAY).detail).toEqual({ label: 'Still open', text: '1 to-do' });
  });

  test('says so when nothing at all is open — including once the last task is ticked', () => {
    const empty = { headline: 'Your desk is clear', overdueChip: 0, tone: 'clear', detail: null };
    expect(daySummary([], TODAY)).toEqual(empty);
    expect(daySummary([task({ dueDate: null, status: 'done' })], TODAY)).toEqual(empty);
  });
});

describe('parseQuickAdd', () => {
  test('takes a trailing date word off the title', () => {
    expect(parseQuickAdd('Call the bank tomorrow', SATURDAY)).toEqual({ title: 'Call the bank', dueDate: '2026-10-11' });
    expect(parseQuickAdd('Drop cheque today', SATURDAY)).toEqual({ title: 'Drop cheque', dueDate: '2026-10-10' });
    expect(parseQuickAdd('Courier papers friday', SATURDAY)).toEqual({ title: 'Courier papers', dueDate: '2026-10-16' });
  });

  test('a weekday matching today means next week', () => {
    expect(parseQuickAdd('Gym sat', SATURDAY).dueDate).toBe('2026-10-17');
  });

  test('leaves plain titles and a lone date word alone', () => {
    expect(parseQuickAdd('  Buy   stamps ', SATURDAY)).toEqual({ title: 'Buy stamps', dueDate: null });
    expect(parseQuickAdd('Tomorrow', SATURDAY)).toEqual({ title: 'Tomorrow', dueDate: null });
  });
});

describe('sources and trail', () => {
  const chat = { id: 9, source: 'whatsapp' as const, chatName: 'Family', sender: 'Mom', text: 'pls pay', sentAt: '2026-10-10T08:00:00.000Z', isFromYou: false };
  const email = { id: 4, subject: 'Your PG&E bill is ready', fromName: 'PG&E', fromAddress: 'noreply@pge.com', receivedAt: '', isFromYou: false };
  const hint = { relation: 'done-hint' as const, source: 'whatsapp' as const, refId: 2, label: 'Family', from: 'Mom', text: 'Paid', at: '', isFromYou: false };

  test('originOf names the group and the person', () => {
    expect(originOf(task({ chat }))).toEqual({ origin: 'whatsapp', who: 'Family · Mom' });
    expect(originOf(task({ chat: { ...chat, chatName: 'Mom', sender: 'Mom' } }))).toEqual({ origin: 'whatsapp', who: 'Mom' });
    expect(originOf(task({ message: email }))).toEqual({ origin: 'email', who: 'PG&E' });
    expect(originOf(task())).toEqual({ origin: 'manual', who: null });
  });

  test('originOf does not name you on your own list', () => {
    expect(originOf(task({ chat: { ...chat, chatName: 'Neeraj Maurya', sender: '', isFromYou: true } }))).toEqual({
      origin: 'whatsapp',
      who: null,
    });
    expect(originOf(task({ message: { ...email, fromName: 'Neeraj Maurya', isFromYou: true } }))).toEqual({
      origin: 'email',
      who: null,
    });
  });

  test('sourcesOf lists each channel that mentioned the task once', () => {
    expect(sourcesOf(task({ message: email, related: [hint, { ...hint, relation: 'mention' }] }))).toEqual(['email', 'whatsapp']);
    expect(sourcesOf(task())).toEqual([]);
  });

  test('doneHintOf only speaks for open tasks', () => {
    expect(doneHintOf(task({ related: [hint] }))).toBe(hint);
    expect(doneHintOf(task({ related: [hint], status: 'done' }))).toBeNull();
    expect(doneHintOf(task({ related: [{ ...hint, relation: 'followup' }] }))).toBeNull();
  });

  test('formatTrailTime is relative near today', () => {
    const now = new Date(2026, 9, 10, 18, 0);
    expect(formatTrailTime(new Date(2026, 9, 9, 9, 0).toISOString(), now)).toBe('Yesterday');
    expect(formatTrailTime('nonsense', now)).toBe('');
  });
});
