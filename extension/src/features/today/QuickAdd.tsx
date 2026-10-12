/**
 * Manual task entry — a secondary gesture, so it stays folded away.
 *
 * DayDesk finds most work on its own; adding by hand is the exception. The
 * resting state is a small "+" beside the date (AddButton); the input only
 * appears when asked for, by click or the N key. Typing "Call bank tomorrow"
 * sets the date, and the chip shows what was understood before Enter.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { dueLabel, parseQuickAdd, toDateKey } from '../../lib/tasks.js';

interface AddButtonProps {
  readonly isOpen: boolean;
  readonly onOpen: () => void;
}

export function AddButton({ isOpen, onOpen }: AddButtonProps) {
  return (
    <button
      type="button"
      className="add-button"
      aria-expanded={isOpen}
      aria-controls="quick-add"
      aria-keyshortcuts="N"
      title="Add a to-do (N)"
      onClick={onOpen}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 3v10M3 8h10" />
      </svg>
      <span className="visually-hidden">Add a to-do</span>
    </button>
  );
}

interface QuickAddProps {
  readonly onAdd: (title: string, dueDate: string | null) => Promise<void>;
  readonly onClose: () => void;
}

export function QuickAdd({ onAdd, onClose }: QuickAddProps) {
  const [text, setText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const today = new Date();
  const parsed = parseQuickAdd(text, today);
  const hint = parsed.dueDate ? dueLabel(parsed.dueDate, toDateKey(today)) : null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!parsed.title || isSaving) return;
    setIsSaving(true);
    try {
      await onAdd(parsed.title, parsed.dueDate);
      // Stay open: adding one thing by hand often means adding a few.
      setText('');
    } finally {
      setIsSaving(false);
      inputRef.current?.focus();
    }
  };

  return (
    <form id="quick-add" className="quick-add" onSubmit={(event) => void submit(event)}>
      <input
        ref={inputRef}
        className="quick-add__input"
        type="text"
        value={text}
        maxLength={200}
        placeholder="Add a to-do — try “renew licence friday”"
        aria-label="Add a to-do"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        // Folding away on blur only when empty, so a half-typed task is never lost.
        onBlur={() => {
          if (!text.trim() && !isSaving) onClose();
        }}
        disabled={isSaving}
      />
      {hint && <span className="quick-add__hint">{hint}</span>}
    </form>
  );
}
