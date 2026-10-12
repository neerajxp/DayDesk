/**
 * "Deleted … · Undo" — the safety net for deleting, instead of an "are you
 * sure?" dialog. Shows for a few seconds after a delete, then goes away.
 */

import { useEffect } from 'react';

/** How long the Undo stays on screen. */
export const UNDO_WINDOW_MS = 6_000;

export interface UndoAction {
  /** Bumped per action, so a second delete restarts the timer. */
  readonly id: number;
  readonly message: string;
  readonly undo: () => Promise<void>;
}

interface UndoToastProps {
  readonly action: UndoAction | null;
  readonly onDone: () => void;
}

export function UndoToast({ action, onDone }: UndoToastProps) {
  useEffect(() => {
    if (!action) return;
    const timer = setTimeout(onDone, UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [action, onDone]);

  if (!action) return null;

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span className="undo-toast__message">{action.message}</span>
      <button
        type="button"
        className="undo-toast__button"
        onClick={() => {
          onDone();
          void action.undo();
        }}
      >
        Undo
      </button>
    </div>
  );
}
