/**
 * Task domain types — the "what needs doing" layer on top of the mail archive.
 *
 * Tasks are DayDesk's own data. Marking one done never touches Yahoo; it only
 * changes a row in the local database.
 */

/** What kind of action a task asks for. Drives the icon and grouping in the panel. */
export type TaskKind = 'pay' | 'sign' | 'cheque' | 'reply' | 'deadline' | 'todo';

export type TaskStatus = 'open' | 'done' | 'dismissed';

/** Where a task came from: a rule matched an email, or the user typed it. */
export type TaskSource = 'rule' | 'manual';

export interface Task {
  readonly id: number;
  readonly kind: TaskKind;
  readonly title: string;
  /** Local calendar date, YYYY-MM-DD. Null means "no date found — do whenever". */
  readonly dueDate: string | null;
  /** Amount as written in the email, e.g. "$84.20". Never parsed into a number. */
  readonly amount: string | null;
  readonly status: TaskStatus;
  readonly source: TaskSource;
  readonly createdAt: string;
  readonly doneAt: string | null;
  /** The email this task was found in, if any. */
  readonly message: {
    readonly id: number;
    readonly subject: string;
    readonly fromName: string;
    readonly fromAddress: string;
    readonly receivedAt: string;
    /** You sent it (e.g. a reminder emailed to yourself) — the board hides the sender. */
    readonly isFromYou: boolean;
  } | null;
  /** The chat message this task was found in, if any. */
  readonly chat: ChatRef | null;
  /** Later emails and chat messages about the same work, oldest first. */
  readonly related: readonly RelatedItem[];
}

export type LinkRelation = 'followup' | 'mention' | 'done-hint';

/** One step on a task's trail — an email or a chat message that refers to it. */
export interface RelatedItem {
  readonly relation: LinkRelation;
  readonly source: 'email' | ChatSource;
  /** messages.id for email, chat_messages.id for chat. */
  readonly refId: number;
  /** Email subject, or chat name. */
  readonly label: string;
  /** Email sender, or chat message sender. */
  readonly from: string;
  readonly text: string;
  readonly at: string;
  readonly isFromYou: boolean;
}

export type ChatSource = 'whatsapp';

export interface ChatRef {
  readonly id: number;
  readonly source: ChatSource;
  readonly chatName: string;
  readonly sender: string;
  readonly text: string;
  readonly sentAt: string;
  /** Your own message, or your own "message yourself" chat. */
  readonly isFromYou: boolean;
}

/** A task proposed by the rules engine, before it is stored. */
export interface TaskCandidate {
  readonly kind: TaskKind;
  readonly title: string;
  readonly dueDate: string | null;
  readonly amount: string | null;
}

export const TASK_KINDS: readonly TaskKind[] = ['pay', 'sign', 'cheque', 'reply', 'deadline', 'todo'];
