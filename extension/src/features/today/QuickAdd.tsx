/**
 * One-line task entry. Typing "Call bank tomorrow" sets the date for you; the
 * date chip shows what was understood before you press Enter.
 */

import { useState, type FormEvent } from 'react';
import { dueLabel, parseQuickAdd, toDateKey } from '../../lib/tasks.js';

interface QuickAddProps {
  readonly onAdd: (title: string, dueDate: string | null) => Promise<void>;
}

export function QuickAdd({ onAdd }: QuickAddProps) {
  const [text, setText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const today = new Date();
  const parsed = parseQuickAdd(text, today);
  const hint = parsed.dueDate ? dueLabel(parsed.dueDate, toDateKey(today)) : null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!parsed.title || isSaving) return;
    setIsSaving(true);
    try {
      await onAdd(parsed.title, parsed.dueDate);
      setText('');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className="quick-add" onSubmit={(event) => void submit(event)}>
      <span className="quick-add__plus" aria-hidden="true">
        +
      </span>
      <input
        className="quick-add__input"
        type="text"
        value={text}
        maxLength={200}
        placeholder="Add a to-do — try “renew licence friday”"
        aria-label="Add a to-do"
        onChange={(event) => setText(event.target.value)}
        disabled={isSaving}
      />
      {hint && <span className="quick-add__hint">{hint}</span>}
    </form>
  );
}
