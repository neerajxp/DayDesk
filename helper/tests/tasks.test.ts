import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { MailSession } from '../src/mail/session.js';
import { createServer, type DayDeskServer } from '../src/server/app.js';
import { createTestDatabase } from '../src/store/db.js';
import { upsertAccount } from '../src/store/accounts.js';
import { upsertFolder } from '../src/store/folders.js';
import { deleteByUids, insertMessages, saveBody, type MessageInsert } from '../src/store/messages.js';
import {
  createManualTask,
  listMissingBodies,
  listTasks,
  saveRuleTasks,
  updateTask,
} from '../src/store/tasks.js';
import { scanForTasks } from '../src/tasks/scan.js';

const NOW = new Date(2026, 9, 10, 12, 0, 0);
const TOKEN = 'test-token-value';
const auth = { authorization: `Bearer ${TOKEN}`, host: '127.0.0.1:4287' };

function message(uid: number, overrides: Partial<MessageInsert> = {}): MessageInsert {
  return {
    uid,
    messageId: `<${uid}@example.com>`,
    subject: `Message ${uid}`,
    from: { name: 'PG&E', address: 'noreply@pge.com' },
    to: [],
    cc: [],
    date: null,
    internalDate: new Date(2026, 9, 9, 9, 0, 0).toISOString(),
    size: 1000,
    flags: [],
    isSeen: false,
    isFlagged: false,
    hasAttachments: false,
    snippet: '',
    ...overrides,
  };
}

function messageId(db: Database, uid: number): number {
  return (db.prepare('SELECT id FROM messages WHERE uid = ?').get(uid) as { id: number }).id;
}

describe('task store and scanner', () => {
  let db: Database;
  let accountId: number;
  let inboxId: number;
  let sentId: number;

  beforeEach(() => {
    db = createTestDatabase();
    accountId = upsertAccount(db, 'me@yahoo.com', 'yahoo').id;
    inboxId = upsertFolder(db, accountId, 'inbox', 'INBOX').id;
    sentId = upsertFolder(db, accountId, 'sent', 'Sent').id;
  });

  const scan = () => scanForTasks(db, accountId, { now: NOW, windowDays: 30 });
  const doneSince = new Date(2026, 9, 10).toISOString();

  test('turns a bill in the inbox into a pay task linked to its email', () => {
    insertMessages(db, inboxId, [message(1, { subject: 'Your PG&E bill is ready' })]);

    const result = scan();

    expect(result).toEqual({ scanned: 1, added: 1, linked: 0, firstTitle: 'Pay PG&E' });
    const [task] = listTasks(db, accountId, { doneSince });
    expect(task).toMatchObject({ kind: 'pay', status: 'open', source: 'rule' });
    expect(task?.message?.subject).toBe('Your PG&E bill is ready');
  });

  test('ignores sent mail and mail older than the window', () => {
    insertMessages(db, sentId, [message(1, { subject: 'Your bill is ready' })]);
    insertMessages(db, inboxId, [
      message(2, { subject: 'Your bill is ready', internalDate: new Date(2026, 6, 1).toISOString() }),
    ]);

    expect(scan().added).toBe(0);
  });

  test('scans each message once, then again when its body arrives — refining the open task', () => {
    insertMessages(db, inboxId, [message(1, { subject: 'Your PG&E bill is ready' })]);
    scan();
    expect(scan().scanned).toBe(0);

    saveBody(db, messageId(db, 1), { text: 'Amount due: $84.20. Due date: Oct 15, 2026', html: null });
    const rescan = scan();

    expect(rescan).toMatchObject({ scanned: 1, added: 0 });
    const [task] = listTasks(db, accountId, { doneSince });
    expect(task).toMatchObject({ amount: '$84.20', dueDate: '2026-10-15' });
  });

  test('rescans messages checked by an older version of the rules', () => {
    insertMessages(db, inboxId, [message(1, { subject: 'pay invoice to testfirm' })]);
    scan();
    // Simulate a scan recorded by rules that did not recognise this email.
    db.prepare('UPDATE task_scans SET rules_version = 0').run();
    db.prepare('DELETE FROM tasks').run();

    expect(scan()).toMatchObject({ scanned: 1, added: 1, firstTitle: 'Pay testfirm' });
    expect(scan().scanned).toBe(0);
  });

  test('never resurrects or rewrites a task the user already finished', () => {
    insertMessages(db, inboxId, [message(1, { subject: 'Your PG&E bill is ready' })]);
    scan();
    const [task] = listTasks(db, accountId, { doneSince });
    updateTask(db, accountId, task!.id, { status: 'dismissed' });

    saveBody(db, messageId(db, 1), { text: 'Amount due $10 by Oct 15', html: null });
    scan();

    expect(listTasks(db, accountId, { doneSince })).toEqual([]);
    const row = db.prepare('SELECT status, amount FROM tasks').get();
    expect(row).toEqual({ status: 'dismissed', amount: null });
  });

  test('keeps a task when its email is deleted from the server, minus the link', () => {
    insertMessages(db, inboxId, [message(1, { subject: 'Your PG&E bill is ready' })]);
    scan();

    deleteByUids(db, inboxId, [1]);

    const [task] = listTasks(db, accountId, { doneSince });
    expect(task).toMatchObject({ title: 'Pay PG&E', message: null });
  });

  test('stamps done_at on completion, keeps it on repeat, clears it on undo', () => {
    const task = createManualTask(db, accountId, { title: 'Buy stamps', kind: 'todo', dueDate: null });

    const done = updateTask(db, accountId, task.id, { status: 'done' })!;
    expect(done.doneAt).not.toBeNull();
    expect(updateTask(db, accountId, task.id, { status: 'done' })!.doneAt).toBe(done.doneAt);
    expect(updateTask(db, accountId, task.id, { status: 'open' })!.doneAt).toBeNull();
  });

  test('lists dated tasks soonest first, undated last, and hides old completed tasks', () => {
    const later = createManualTask(db, accountId, { title: 'Later', kind: 'todo', dueDate: '2026-10-20' });
    createManualTask(db, accountId, { title: 'Undated', kind: 'todo', dueDate: null });
    createManualTask(db, accountId, { title: 'Sooner', kind: 'todo', dueDate: '2026-10-12' });
    updateTask(db, accountId, later.id, { status: 'done' });

    expect(listTasks(db, accountId, { doneSince: '2000-01-01' }).map((t) => t.title)).toEqual([
      'Sooner',
      'Later',
      'Undated',
    ]);
    expect(listTasks(db, accountId, { doneSince: '2999-01-01' }).map((t) => t.title)).toEqual(['Sooner', 'Undated']);
  });

  test('reports only genuinely new rule tasks', () => {
    insertMessages(db, inboxId, [message(1)]);
    const id = messageId(db, 1);
    const candidate = { kind: 'pay' as const, title: 'Pay X', dueDate: null, amount: null };

    expect(saveRuleTasks(db, accountId, { messageId: id }, [candidate])).toHaveLength(1);
    expect(saveRuleTasks(db, accountId, { messageId: id }, [candidate])).toHaveLength(0);
  });

  test('prefetch queue skips oversized messages and ones that already have a body', () => {
    insertMessages(db, inboxId, [message(1), message(2, { size: 10_000_000 }), message(3)]);
    saveBody(db, messageId(db, 3), { text: 'x', html: null });

    const queue = listMissingBodies(db, accountId, { sinceIso: '2026-01-01', limit: 10, maxBytes: 2_000_000 });
    expect(queue.map((item) => item.uid)).toEqual([1]);
  });
});

describe('task routes', () => {
  let db: Database;
  let server: DayDeskServer;

  beforeEach(async () => {
    db = createTestDatabase();
    const session = { getStatus: () => ({}), stop: async () => {} } as unknown as MailSession;
    server = await createServer({ db, session, token: TOKEN, port: 4287, restartSession: async () => {}, logging: false });
  });

  afterEach(async () => {
    await server.close();
  });

  function pair(): void {
    upsertAccount(db, 'me@yahoo.com', 'yahoo');
  }

  test('requires the pairing token', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/api/tasks', headers: { host: auth.host } });
    expect(response.statusCode).toBe(401);
  });

  test('returns 409 before pairing', async () => {
    const response = await server.app.inject({ method: 'GET', url: '/api/tasks', headers: auth });
    expect(response.statusCode).toBe(409);
  });

  test('creates a manual to-do, then ticks it off', async () => {
    pair();
    const created = await server.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: auth,
      payload: { title: '  Renew car insurance  ', dueDate: '2026-10-20' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ title: 'Renew car insurance', kind: 'todo', source: 'manual' });

    const patched = await server.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.json().id}`,
      headers: auth,
      payload: { status: 'done' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe('done');

    const list = await server.app.inject({ method: 'GET', url: '/api/tasks', headers: auth });
    expect(list.json().tasks).toHaveLength(1);
  });

  test('rejects a blank title, an unknown kind and an impossible date', async () => {
    pair();
    const post = (payload: object) => server.app.inject({ method: 'POST', url: '/api/tasks', headers: auth, payload });

    expect((await post({ title: '   ' })).statusCode).toBe(400);
    expect((await post({ title: 'x', kind: 'shopping' })).statusCode).toBe(400);
    expect((await post({ title: 'x', dueDate: '2026-02-31' })).statusCode).toBe(400);
    expect((await post({ title: 'x', dueDate: 'tomorrow' })).statusCode).toBe(400);
  });

  test('rejects an empty patch and an unknown status', async () => {
    pair();
    const task = createManualTask(db, 1, { title: 'x', kind: 'todo', dueDate: null });
    const patch = (payload: object) =>
      server.app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, headers: auth, payload });

    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ status: 'archived' })).statusCode).toBe(400);
  });

  test('returns 404 for a task that does not exist', async () => {
    pair();
    const response = await server.app.inject({
      method: 'PATCH',
      url: '/api/tasks/999',
      headers: auth,
      payload: { status: 'done' },
    });
    expect(response.statusCode).toBe(404);
  });

  test('clears a due date with null', async () => {
    pair();
    const task = createManualTask(db, 1, { title: 'x', kind: 'todo', dueDate: '2026-10-20' });
    const response = await server.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: auth,
      payload: { dueDate: null },
    });
    expect(response.json().dueDate).toBeNull();
  });
});

describe('knowing who "you" are', () => {
  test('marks tasks you sent yourself — by address, by Sent-mail name, and in your own WhatsApp chat', async () => {
    const { insertChatMessage } = await import('../src/store/chat.js');
    const db = createTestDatabase();
    const accountId = upsertAccount(db, 'neerajxp@yahoo.com', 'yahoo').id;
    const inboxId = upsertFolder(db, accountId, 'inbox', 'INBOX').id;
    const sentId = upsertFolder(db, accountId, 'sent', 'Sent').id;

    // Your Sent mail teaches the helper your display name.
    insertMessages(db, sentId, [message(1, { from: { name: 'Neeraj Maurya', address: 'neerajxp@yahoo.com' } })]);
    insertMessages(db, inboxId, [
      message(2, { subject: 'pay invoice to testfirm', from: { name: 'Neeraj Maurya', address: 'neerajxp@gmail.com' } }),
      message(3, { subject: 'Your PG&E bill is ready' }),
    ]);
    scanForTasks(db, accountId, { now: NOW, windowDays: 30 });

    const chatRow = insertChatMessage(db, {
      source: 'whatsapp',
      chatName: 'Neeraj Maurya',
      sender: '',
      text: 'pay credit card bill',
      isFromMe: false,
      sentAt: NOW,
    });
    saveRuleTasks(db, accountId, { chatMessageId: chatRow.id }, [
      { kind: 'pay', title: 'Pay credit card bill', dueDate: null, amount: null },
    ]);

    const byTitle = new Map(listTasks(db, accountId, { doneSince: '2000-01-01' }).map((t) => [t.title, t]));
    expect(byTitle.get('Pay testfirm')?.message?.isFromYou).toBe(true);
    expect(byTitle.get('Pay PG&E')?.message?.isFromYou).toBe(false);
    expect(byTitle.get('Pay credit card bill')?.chat?.isFromYou).toBe(true);
  });
});

describe('PATCH /api/tasks/:id/related', () => {
  test('validates its body', async () => {
    const db = createTestDatabase();
    const session = { getStatus: () => ({}), stop: async () => {} } as unknown as MailSession;
    const server = await createServer({ db, session, token: TOKEN, port: 4287, restartSession: async () => {}, logging: false });
    upsertAccount(db, 'me@yahoo.com', 'yahoo');
    const patch = (payload: object) =>
      server.app.inject({ method: 'PATCH', url: '/api/tasks/1/related', headers: auth, payload });

    expect((await patch({ source: 'sms', refId: 1, hidden: true })).statusCode).toBe(400);
    expect((await patch({ source: 'email', refId: 1 })).statusCode).toBe(400);
    expect((await patch({ source: 'email', refId: 1, hidden: true })).statusCode).toBe(404);
    await server.close();
  });
});
