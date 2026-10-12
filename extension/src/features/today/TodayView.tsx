/**
 * Today board container: loads tasks, applies changes optimistically, and
 * opens a task's source email in place.
 *
 * The only component in the feature that talks to the API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DayDeskApi } from '../../lib/api/client.js';
import type { MessageDetail, Task, TaskPatch } from '../../lib/api/types.js';
import { addDays, briefing, BUCKET_LABELS, BUCKET_ORDER, groupTasks, toDateKey } from '../../lib/tasks.js';
import { MessageView } from '../mail/MessageView.js';
import { AddButton, QuickAdd } from './QuickAdd.js';
import { TaskRow } from './TaskRow.js';
import './today.css';

/** How long a ticked task stays in place, struck through, before it moves to Done. */
const SETTLE_MS = 700;

interface TodayViewProps {
  readonly api: DayDeskApi;
  /** Bumped by the shell when the helper reports new tasks. */
  readonly refreshKey: number;
}

export function TodayView({ api, refreshKey }: TodayViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState<ReadonlySet<number>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [openMessage, setOpenMessage] = useState<MessageDetail | null>(null);
  const settleTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const now = new Date();
  const todayKey = toDateKey(now);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.tasks();
      setTasks(result.tasks);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your tasks.');
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // N opens the add box from anywhere on the board — unless you are already typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      event.preventDefault();
      setIsAdding(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const timers = settleTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  /** Apply a change locally first; roll back and say so if the helper refuses. */
  const patchTask = useCallback(
    async (task: Task, patch: TaskPatch, optimistic: Task | null) => {
      const snapshot = tasks;
      setTasks((current) =>
        optimistic ? current.map((item) => (item.id === task.id ? optimistic : item)) : current.filter((item) => item.id !== task.id),
      );
      try {
        const saved = await api.updateTask(task.id, patch);
        if (optimistic) setTasks((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      } catch (cause) {
        setTasks(snapshot);
        setError(cause instanceof Error ? `Couldn’t save that: ${cause.message}` : 'Couldn’t save that change.');
      }
    },
    [api, tasks],
  );

  const toggle = useCallback(
    (task: Task) => {
      const pending = settleTimers.current.get(task.id);
      if (pending) {
        // Second click during the settle: an instant undo, nothing was saved yet.
        clearTimeout(pending);
        settleTimers.current.delete(task.id);
        setSettling((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
        return;
      }
      if (task.status === 'done') {
        void patchTask(task, { status: 'open' }, { ...task, status: 'open', doneAt: null });
        return;
      }
      // Let the tick and strike-through play where the row is, then move it.
      setSettling((current) => new Set(current).add(task.id));
      settleTimers.current.set(
        task.id,
        setTimeout(() => {
          setSettling((current) => {
            const next = new Set(current);
            next.delete(task.id);
            return next;
          });
          settleTimers.current.delete(task.id);
          void patchTask(task, { status: 'done' }, { ...task, status: 'done', doneAt: new Date().toISOString() });
        }, SETTLE_MS),
      );
    },
    [patchTask],
  );

  const snooze = useCallback(
    (task: Task) => {
      const dueDate = toDateKey(addDays(new Date(), 1));
      void patchTask(task, { dueDate }, { ...task, dueDate });
    },
    [patchTask],
  );

  const dismiss = useCallback((task: Task) => void patchTask(task, { status: 'dismissed' }, null), [patchTask]);

  const add = useCallback(
    async (title: string, dueDate: string | null) => {
      try {
        const created = await api.createTask({ title, dueDate });
        setTasks((current) => [...current, created]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not add that.');
        throw cause;
      }
    },
    [api],
  );

  const openEmail = useCallback(
    async (messageId: number) => {
      try {
        setOpenMessage(await api.message(messageId));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not open that email.');
      }
    },
    [api],
  );

  const groups = useMemo(() => groupTasks(tasks, todayKey), [tasks, todayKey]);
  const summary = useMemo(() => briefing(tasks, todayKey), [tasks, todayKey]);

  if (openMessage) {
    return <MessageView message={openMessage} onBack={() => setOpenMessage(null)} />;
  }

  return (
    <div className="scroller today">
      <header className="today__header">
        <div className="today__dateline">
          <div>
            <p className="today__weekday">{now.toLocaleDateString(undefined, { weekday: 'long' })}</p>
            <h2 className="today__date">{now.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}</h2>
          </div>
          <AddButton isOpen={isAdding} onOpen={() => setIsAdding(true)} />
        </div>
        <p className="today__briefing">{isLoading ? '\u00a0' : summary}</p>
      </header>

      {isAdding && <QuickAdd onAdd={add} onClose={() => setIsAdding(false)} />}

      {error && (
        <p className="error-text today__error" role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="today__skeleton" aria-busy="true">
          {[70, 85, 60].map((width) => (
            <div key={width} className="skeleton" style={{ width: `${width}%` }} />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="today__empty">
          <p className="today__empty-title">Nothing waiting on you.</p>
          <p className="state__text">
            DayDesk reads the last 30 days of your inbox and the WhatsApp chats you choose for bills, signatures,
            cheques and requests, and lists them here. Add anything else with + or the N key.
          </p>
        </div>
      ) : (
        BUCKET_ORDER.filter((bucket) => groups.has(bucket)).map((bucket) => (
          <section key={bucket} className="bucket" data-bucket={bucket} aria-labelledby={`bucket-${bucket}`}>
            <h3 className="bucket__title" id={`bucket-${bucket}`}>
              {BUCKET_LABELS[bucket]}
              <span className="bucket__count">{groups.get(bucket)!.length}</span>
            </h3>
            <ul className="bucket__list">
              {groups.get(bucket)!.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  todayKey={todayKey}
                  isSettling={settling.has(task.id)}
                  onToggle={toggle}
                  onSnooze={snooze}
                  onDismiss={dismiss}
                  onOpenEmail={(messageId) => void openEmail(messageId)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
