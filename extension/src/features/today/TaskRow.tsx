/**
 * One line on the Today board. Presentational — every action is a callback.
 *
 * Ticking the box is the primary gesture, so it is the largest target on the
 * row and sits where the eye starts. Secondary actions only appear on hover
 * or keyboard focus, keeping the resting board calm.
 *
 * A task can come from email, WhatsApp, or both: the badges say which, the
 * trail shows the conversation, and a "says done" report is offered as a
 * one-click confirmation — never applied on its own.
 */

import type { RelatedItem, Task } from '../../lib/api/types.js';
import { doneHintOf, dueLabel, KIND_LABELS, originOf, sourcesOf } from '../../lib/tasks.js';
import { TaskTrail } from './TaskTrail.js';

/** Show the original message only when it says more than the title already does. */
const QUOTE_MIN_EXTRA_CHARS = 20;
function addsToTitle(text: string, title: string): boolean {
  const normalize = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const body = normalize(text);
  const head = normalize(title.replace(/…$/, ''));
  return !(body.startsWith(head) && body.length - head.length < QUOTE_MIN_EXTRA_CHARS);
}

interface TaskRowProps {
  readonly task: Task;
  readonly todayKey: string;
  /** Briefly true between the tick and the row moving to "Done". */
  readonly isSettling: boolean;
  readonly onToggle: (task: Task) => void;
  readonly onSnooze: (task: Task) => void;
  /** Delete the task (undoable). */
  readonly onDismiss: (task: Task) => void;
  readonly onOpenEmail: (messageId: number) => void;
  /** Remove one message from the task's trail (undoable). */
  readonly onRemoveRelated: (task: Task, item: RelatedItem) => void;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.4a1 1 0 0 0 1 .93h4.8a1 1 0 0 0 1-.93l.6-8.4M6.75 7v4M9.25 7v4" />
    </svg>
  );
}

export function TaskRow({
  task,
  todayKey,
  isSettling,
  onToggle,
  onSnooze,
  onDismiss,
  onOpenEmail,
  onRemoveRelated,
}: TaskRowProps) {
  const isDone = task.status === 'done' || isSettling;
  const due = isDone ? null : dueLabel(task.dueDate, todayKey);
  const isOverdue = !isDone && task.dueDate !== null && task.dueDate < todayKey;

  const { origin, who } = originOf(task);
  // "Pay PG&E" already says who; don't repeat it underneath.
  const sender = who && !task.title.includes(who) ? who : null;
  const sources = sourcesOf(task);
  const hint = isDone ? null : doneHintOf(task);
  const quote = task.chat && addsToTitle(task.chat.text, task.title) ? task.chat.text : null;

  return (
    <li className="task" data-kind={task.kind} data-done={isDone}>
      <button
        type="button"
        className="task__check"
        role="checkbox"
        aria-checked={isDone}
        aria-label={isDone ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
        onClick={() => onToggle(task)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </button>

      <div className="task__body">
        <div className="task__head">
          <span className="task__kind">{KIND_LABELS[task.kind]}</span>
          {sources.map((source) => (
            <span key={source} className="source-badge" data-source={source}>
              {source === 'email' ? 'Email' : 'WhatsApp'}
            </span>
          ))}
          {sender && <span className="task__sender">{sender}</span>}
          {due && (
            <span className="task__due" data-overdue={isOverdue}>
              {due}
            </span>
          )}
          <button
            type="button"
            className="task__delete"
            aria-label={`Delete “${task.title}”`}
            title="Delete"
            onClick={() => onDismiss(task)}
          >
            <TrashIcon />
          </button>
        </div>

        <p className="task__title">{task.title}</p>

        {task.amount && (
          <p className="task__meta">
            <span className="task__amount">{task.amount}</span>
          </p>
        )}

        {quote && !isDone && <p className="task__quote">“{quote}”</p>}

        {hint && (
          <div className="done-hint" role="note">
            <p className="done-hint__text">
              <strong>{hint.isFromYou ? 'You' : hint.source === 'email' ? hint.from : hint.from || hint.label}</strong>{' '}
              {hint.isFromYou ? 'said it’s done' : 'says it’s done'}:{' '}
              <span>“{hint.source === 'email' ? hint.label : hint.text}”</span>
            </p>
            <button type="button" className="done-hint__confirm" onClick={() => onToggle(task)}>
              Mark done
            </button>
          </div>
        )}

        {!isDone && (
          <TaskTrail items={task.related} onOpenEmail={onOpenEmail} onRemove={(item) => onRemoveRelated(task, item)} />
        )}

        {!isDone && (
          <div className="task__actions">
            {origin === 'email' && task.message && (
              <button type="button" className="task__action" onClick={() => onOpenEmail(task.message!.id)}>
                Open email
              </button>
            )}
            <button type="button" className="task__action" onClick={() => onSnooze(task)}>
              Tomorrow
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
