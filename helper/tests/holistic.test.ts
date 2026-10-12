/**
 * Mail + WhatsApp as one to-do list: the same work arriving from both sides
 * must end up as one task with a trail, not two tasks.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDatabase } from '../src/store/db.js';
import { upsertAccount } from '../src/store/accounts.js';
import { upsertFolder } from '../src/store/folders.js';
import { insertMessages, saveBody, type MessageInsert } from '../src/store/messages.js';
import { insertChatMessage } from '../src/store/chat.js';
import { listTasks, updateTask } from '../src/store/tasks.js';
import { scanForTasks } from '../src/tasks/scan.js';
import { extractChatTask } from '../src/tasks/chat.js';
import { ingest } from '../src/tasks/ingest.js';

const NOW = new Date();

describe('mail and WhatsApp as one list', () => {
  let db: Database;
  let accountId: number;
  let inboxId: number;
  let nextUid = 1;

  beforeEach(() => {
    db = createTestDatabase();
    accountId = upsertAccount(db, 'me@yahoo.com', 'yahoo').id;
    inboxId = upsertFolder(db, accountId, 'inbox', 'INBOX').id;
    nextUid = 1;
  });

  function email(subject: string, body: string, from = { name: 'PG&E', address: 'noreply@pge.com' }): void {
    const uid = nextUid++;
    const message: MessageInsert = {
      uid,
      messageId: null,
      subject,
      from,
      to: [],
      cc: [],
      date: null,
      internalDate: NOW.toISOString(),
      size: 100,
      flags: [],
      isSeen: false,
      isFlagged: false,
      hasAttachments: false,
      snippet: '',
    };
    insertMessages(db, inboxId, [message]);
    const { id } = db.prepare('SELECT id FROM messages WHERE uid = ?').get(uid) as { id: number };
    saveBody(db, id, { text: body, html: null });
    scanForTasks(db, accountId, { now: NOW, windowDays: 30 });
  }

  function whatsapp(text: string, chatName = 'Family', sender = 'Mom') {
    const input = { source: 'whatsapp' as const, chatName, sender, text, isFromMe: false, sentAt: NOW };
    const row = insertChatMessage(db, input);
    const candidate = extractChatTask(input);
    return ingest(db, accountId, { chatMessageId: row.id }, { candidates: candidate ? [candidate] : [], text, now: NOW });
  }

  const tasks = () => listTasks(db, accountId, { doneSince: '2000-01-01' });

  test('a WhatsApp nudge about an emailed bill joins that task instead of duplicating it', () => {
    email('Your PG&E bill is ready', 'Amount due: $84.20');
    const result = whatsapp('Did you pay the PG&E bill?');

    expect(result).toEqual({ added: [], linked: 1 });
    const [task, ...rest] = tasks();
    expect(rest).toHaveLength(0);
    expect(task?.message?.subject).toBe('Your PG&E bill is ready');
    expect(task?.related).toEqual([
      expect.objectContaining({ relation: 'followup', source: 'whatsapp', label: 'Family', from: 'Mom' }),
    ]);
  });

  test('an emailed invoice joins the task first asked for on WhatsApp, and fills in its date', () => {
    whatsapp('Please pay ₹2,400 to Sharma ji for the plumber');
    email('Invoice from Sharma Plumbing', 'Amount due ₹2,400. Due date: Dec 20, 2026', {
      name: 'Sharma Plumbing',
      address: 'accounts@sharmaplumbing.in',
    });

    const [task, ...rest] = tasks();
    expect(rest).toHaveLength(0);
    expect(task?.chat?.text).toContain('Sharma ji');
    expect(task?.dueDate).toBe('2026-12-20');
    expect(task?.related.map((item) => [item.relation, item.source])).toEqual([['followup', 'email']]);
  });

  test('"paid" on WhatsApp leaves a done hint on the emailed bill — but does not tick it off', () => {
    email('Your PG&E bill is ready', 'Amount due: $84.20');
    whatsapp('Paid the PG&E bill');

    const [task] = tasks();
    expect(task?.status).toBe('open');
    expect(task?.related).toEqual([expect.objectContaining({ relation: 'done-hint', text: 'Paid the PG&E bill' })]);
  });

  test('a payment-received email is a done hint for the WhatsApp request', () => {
    whatsapp('Please pay the society maintenance to Green Acres');
    email('Payment received — Green Acres society maintenance', 'Thank you for your payment.', {
      name: 'Green Acres RWA',
      address: 'billing@greenacres.org',
    });

    const [task] = tasks();
    expect(task?.related).toEqual([expect.objectContaining({ relation: 'done-hint', source: 'email' })]);
  });

  test('unrelated work from the two sides stays separate', () => {
    email('Your PG&E bill is ready', 'Amount due: $84.20');
    whatsapp('Please pay the school fees');

    expect(tasks().map((task) => task.title).sort()).toEqual(['Pay PG&E', 'Pay school fees']);
  });

  test('a follow-up never resurrects a finished task on rescan', () => {
    email('Your PG&E bill is ready', 'Amount due: $84.20');
    email('Reminder: your PG&E payment is due', 'Amount due: $84.20 by Oct 30');
    expect(tasks()).toHaveLength(1);

    updateTask(db, accountId, tasks()[0]!.id, { status: 'done' });
    db.prepare('UPDATE task_scans SET rules_version = 0').run();
    scanForTasks(db, accountId, { now: NOW, windowDays: 30 });

    expect(tasks().filter((task) => task.status === 'open')).toHaveLength(0);
  });
});
