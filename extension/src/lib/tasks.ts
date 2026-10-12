/**
 * Today-board logic. Pure functions, no React — the board is just these
 * functions rendered.
 */

import type { RelatedItem, Task, TaskKind } from './api/types.js';

export type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'whenever' | 'done';

export const BUCKET_ORDER: readonly Bucket[] = ['overdue', 'today', 'week', 'later', 'whenever', 'done'];

export const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'Next 7 days',
  later: 'Later',
  whenever: 'No date',
  done: 'Done today',
};

export const KIND_LABELS: Record<TaskKind, string> = {
  pay: 'Pay',
  sign: 'Sign',
  cheque: 'Cheque',
  reply: 'Reply',
  deadline: 'Deadline',
  todo: 'To-do',
};

const WEEK_DAYS = 7;

/** Local calendar date as YYYY-MM-DD — the same shape the helper stores. */
export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(fromKey: string, toKey: string): number {
  // Round, because a DST change makes one "day" 23 or 25 hours long.
  return Math.round((fromDateKey(toKey).getTime() - fromDateKey(fromKey).getTime()) / 86_400_000);
}

export function bucketOf(task: Task, todayKey: string): Bucket {
  if (task.status === 'done') return 'done';
  if (!task.dueDate) return 'whenever';
  const days = daysBetween(todayKey, task.dueDate);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= WEEK_DAYS) return 'week';
  return 'later';
}

export function groupTasks(tasks: readonly Task[], todayKey: string): ReadonlyMap<Bucket, readonly Task[]> {
  const groups = new Map<Bucket, Task[]>();
  for (const task of tasks) {
    const bucket = bucketOf(task, todayKey);
    groups.set(bucket, [...(groups.get(bucket) ?? []), task]);
  }
  return groups;
}

/** Short, human due label for a task row. */
export function dueLabel(dueDate: string | null, todayKey: string): string | null {
  if (!dueDate) return null;
  const days = daysBetween(todayKey, dueDate);
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return 'Due yesterday';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Tomorrow';
  const date = fromDateKey(dueDate);
  if (days < WEEK_DAYS) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * What the header says, most important first.
 *
 * The headline answers "what needs me today?" — due-today count, or overdue
 * count when nothing is due today, or a calm "nothing due" when clear. The
 * week line says what kind of work the next seven days hold. The date itself
 * is a quiet label above: it is obvious, so it should not be the loudest
 * thing on the board.
 */
export interface DaySummary {
  readonly headline: string;
  /** Overdue count shown as a chip beside a due-today headline (0 = no chip). */
  readonly overdueChip: number;
  readonly tone: 'clear' | 'due' | 'overdue';
  /**
   * The line under the headline: what kind of work the week holds, or — when
   * nothing is dated this week — what is still open with no date or a later
   * one. Null only when nothing at all is open.
   */
  readonly detail: { readonly label: string; readonly text: string } | null;
}

const KIND_PHRASES: Record<TaskKind, (n: number) => string> = {
  pay: (n) => `${n} ${n === 1 ? 'bill' : 'bills'} to pay`,
  sign: (n) => `${n} to sign`,
  cheque: (n) => `${n} ${n === 1 ? 'cheque' : 'cheques'}`,
  reply: (n) => `${n} ${n === 1 ? 'reply' : 'replies'} owed`,
  deadline: (n) => `${n} ${n === 1 ? 'deadline' : 'deadlines'}`,
  todo: (n) => `${n} ${n === 1 ? 'to-do' : 'to-dos'}`,
};
const KIND_ORDER: readonly TaskKind[] = ['pay', 'sign', 'cheque', 'reply', 'deadline', 'todo'];

/** "2 bills to pay · 1 to sign" for a set of tasks. */
function describeKinds(tasks: readonly Task[]): string {
  const kinds = new Map<TaskKind, number>();
  for (const task of tasks) kinds.set(task.kind, (kinds.get(task.kind) ?? 0) + 1);
  return KIND_ORDER.filter((kind) => kinds.has(kind))
    .map((kind) => KIND_PHRASES[kind](kinds.get(kind)!))
    .join(' · ');
}

export function daySummary(tasks: readonly Task[], todayKey: string): DaySummary {
  const byBucket = groupTasks(tasks, todayKey);
  const count = (bucket: Bucket): number => byBucket.get(bucket)?.length ?? 0;
  const pressing = [...(byBucket.get('overdue') ?? []), ...(byBucket.get('today') ?? []), ...(byBucket.get('week') ?? [])];
  const undatedOrLater = [...(byBucket.get('later') ?? []), ...(byBucket.get('whenever') ?? [])];

  const detail =
    pressing.length > 0
      ? { label: 'This week', text: describeKinds(pressing) }
      : undatedOrLater.length > 0
        ? { label: 'Still open', text: describeKinds(undatedOrLater) }
        : null;

  if (count('today') > 0) {
    return { headline: `${count('today')} due today`, overdueChip: count('overdue'), tone: 'due', detail };
  }
  if (count('overdue') > 0) {
    return { headline: `${count('overdue')} overdue`, overdueChip: 0, tone: 'overdue', detail };
  }
  const headline = pressing.length + undatedOrLater.length > 0 ? 'Nothing due today' : 'Your desk is clear';
  return { headline, overdueChip: 0, tone: 'clear', detail };
}

/**
 * Pull a trailing date word off a quick-add line: "Call bank tomorrow" →
 * { title: "Call bank", dueDate: tomorrow }. Deliberately small — anything
 * fancier belongs in the date picker.
 */
export function parseQuickAdd(input: string, today: Date): { title: string; dueDate: string | null } {
  const text = input.trim().replace(/\s+/g, ' ');
  const match = /\s+(today|tonight|tomorrow|tmrw|mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?$/i.exec(
    text,
  );
  if (!match || match.index === 0) return { title: text, dueDate: null };

  const word = match[1]!.toLowerCase();
  const title = text.slice(0, match.index).trim();
  if (word === 'today' || word === 'tonight') return { title, dueDate: toDateKey(today) };
  if (word === 'tomorrow' || word === 'tmrw') return { title, dueDate: toDateKey(addDays(today, 1)) };

  const target = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(word);
  // "fri" on a Friday means next Friday — you would have typed "today".
  const ahead = (target - today.getDay() + 7) % 7 || 7;
  return { title, dueDate: toDateKey(addDays(today, ahead)) };
}

// ── Sources and trail ───────────────────────────────────────────────────────

export type TaskOrigin = 'email' | 'whatsapp' | 'manual';

/**
 * Where a task came from, and who it came from — `who` is null when it was
 * you (a reminder you sent yourself), since naming you on your own list says
 * nothing.
 */
export function originOf(task: Task): { readonly origin: TaskOrigin; readonly who: string | null } {
  if (task.chat) {
    const { chatName, sender, isFromYou } = task.chat;
    if (isFromYou) return { origin: 'whatsapp', who: null };
    // In a one-to-one chat the sender is the chat; in a group, show both.
    const who = sender && sender !== chatName && sender !== 'You' ? `${chatName} · ${sender}` : chatName;
    return { origin: 'whatsapp', who };
  }
  if (task.message) {
    const { fromName, fromAddress, isFromYou } = task.message;
    return { origin: 'email', who: isFromYou ? null : fromName || fromAddress };
  }
  return { origin: 'manual', who: null };
}

/** Every source that has spoken about this task, origin first — e.g. ['email', 'whatsapp']. */
export function sourcesOf(task: Task): readonly TaskOrigin[] {
  const sources = new Set<TaskOrigin>([originOf(task).origin]);
  for (const item of task.related) sources.add(item.source);
  sources.delete('manual');
  return [...sources];
}

/** The latest "this looks done" report, if the task is still open. */
export function doneHintOf(task: Task): RelatedItem | null {
  if (task.status !== 'open') return null;
  return [...task.related].reverse().find((item) => item.relation === 'done-hint') ?? null;
}

/** Compact time for the trail: "14:05" today, "Yesterday", weekday this week, else "9 Oct". */
export function formatTrailTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const days = daysBetween(toDateKey(date), toDateKey(now));
  if (days === 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < WEEK_DAYS) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
