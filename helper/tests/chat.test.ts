import { describe, expect, test } from 'vitest';
import { extractChatTask, type ChatInput } from '../src/tasks/chat.js';

const SENT = new Date(2026, 9, 10, 18, 30, 0); // Sat 10 Oct 2026, evening

function chat(text: string, overrides: Partial<ChatInput> = {}): ChatInput {
  return { text, chatName: 'Family', sender: 'Mom', isFromMe: false, sentAt: SENT, ...overrides };
}

describe('extractChatTask', () => {
  test('turns a request to pay into a pay task with amount and payee', () => {
    expect(extractChatTask(chat('Please pay ₹2,400 to Sharma ji for the plumber by Monday'))).toEqual({
      kind: 'pay',
      title: 'Pay Sharma ji for the plumber',
      dueDate: '2026-10-12',
      amount: '₹2,400',
    });
  });

  test('names what is being paid when no payee is named', () => {
    expect(extractChatTask(chat('pls pay the electricity bill today'))).toMatchObject({
      kind: 'pay',
      title: 'Pay electricity bill',
      dueDate: '2026-10-10',
    });
  });

  test('recognises cheques and signatures in chat', () => {
    expect(extractChatTask(chat('Need a cheque for school fees tomorrow'))?.kind).toBe('cheque');
    expect(extractChatTask(chat('Please sign the agreement and send it back'))?.kind).toBe('sign');
  });

  test('turns a plain request into a to-do', () => {
    expect(extractChatTask(chat("Don't forget to pick up the passport photos tomorrow"))).toMatchObject({
      kind: 'todo',
      title: "Don't forget to pick up the passport photos tomorrow",
      dueDate: '2026-10-11',
    });
    expect(extractChatTask(chat('Can you send me the flat registration papers?'))?.kind).toBe('todo');
  });

  test('honours an explicit marker and strips it from the title', () => {
    expect(extractChatTask(chat('Reminder: renew car insurance by Oct 20'))).toMatchObject({
      kind: 'todo',
      title: 'Renew car insurance by Oct 20',
      dueDate: '2026-10-20',
    });
    expect(extractChatTask(chat('todo - call the CA'))?.title).toBe('Call the CA');
  });

  test('a marker still picks the specific kind', () => {
    expect(extractChatTask(chat('Todo: pay maid salary'))?.kind).toBe('pay');
  });

  test('ignores chit-chat', () => {
    expect(extractChatTask(chat('Good morning 🌞'))).toBeNull();
    expect(extractChatTask(chat('haha yes'))).toBeNull();
    expect(extractChatTask(chat('Reached home'))).toBeNull();
  });

  test('ignores payment confirmations', () => {
    expect(extractChatTask(chat('Payment received, thank you for your payment'))).toBeNull();
  });

  test('ignores your own messages unless you marked them as a task', () => {
    expect(extractChatTask(chat('I will pay the bill', { isFromMe: true }))).toBeNull();
    expect(extractChatTask(chat('todo: pay the bill', { isFromMe: true }))?.kind).toBe('pay');
  });

  test('uses only the first sentence for the title and caps its length', () => {
    const task = extractChatTask(chat(`Please call the bank about the FD renewal. ${'Also some long detail. '.repeat(10)}`));
    expect(task?.title).toBe('Please call the bank about the FD renewal');
  });

  test('reads a terse self-reminder: suffix currency, hyphenated date, clean title', () => {
    expect(extractChatTask(chat('pay credit card bill tomorrow 12-oct for 350$'))).toEqual({
      kind: 'pay',
      title: 'Pay credit card bill',
      dueDate: '2026-10-12',
      amount: '$350',
    });
  });

  test('in chat, an explicit date counts even without a "due" word', () => {
    expect(extractChatTask(chat('pay the rent on 1st Nov'))?.dueDate).toBe('2026-11-01');
    expect(extractChatTask(chat('pay school fees oct-20'))?.dueDate).toBe('2026-10-20');
  });

  test('reads a bare "pay <payee> <amount> <when>" instruction', () => {
    expect(extractChatTask(chat('Pay pseg 25$ today'))).toEqual({
      kind: 'pay',
      title: 'Pay pseg',
      dueDate: '2026-10-10',
      amount: '$25',
    });
    expect(extractChatTask(chat('Pay PSEG $25 by Friday'))).toMatchObject({ kind: 'pay', title: 'Pay PSEG', dueDate: '2026-10-16' });
    expect(extractChatTask(chat('pay Ramesh'))).toMatchObject({ kind: 'pay', title: 'Pay Ramesh' });
    expect(extractChatTask(chat('pay the plumber 500 rs'))).toMatchObject({ kind: 'pay', title: 'Pay the plumber', amount: '₹500' });
  });

  test('does not mistake "pay attention" and friends for a payment', () => {
    expect(extractChatTask(chat('Pay attention to the road'))).toBeNull();
    expect(extractChatTask(chat('pay a visit to grandma'))?.kind).not.toBe('pay');
  });

  test('a message that opens with a clear action verb is a to-do', () => {
    expect(extractChatTask(chat('call the plumber tomorrow'))).toMatchObject({
      kind: 'todo',
      title: 'Call the plumber tomorrow',
      dueDate: '2026-10-11',
    });
    expect(extractChatTask(chat('Book train tickets for Diwali'))?.kind).toBe('todo');
    expect(extractChatTask(chat('recharge the fastag'))?.kind).toBe('todo');
  });

  test('ordinary chat that merely contains a verb stays quiet', () => {
    expect(extractChatTask(chat('I will call you later'))).toBeNull();
    expect(extractChatTask(chat('Booked! see you there'))).toBeNull();
  });

  test('keeps a dated deadline even without a request word', () => {
    expect(extractChatTask(chat('Passport expires on Nov 2'))).toMatchObject({ kind: 'deadline', dueDate: '2026-11-02' });
  });
});

// ── Intake route ───────────────────────────────────────────────────────────

import { afterEach, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { MailSession } from '../src/mail/session.js';
import { createServer, type DayDeskServer } from '../src/server/app.js';
import { createTestDatabase } from '../src/store/db.js';
import { upsertAccount } from '../src/store/accounts.js';
import { listTasks } from '../src/store/tasks.js';
import { bus } from '../src/events.js';
import type { ServerEvent } from '../src/types/mail.js';

describe('POST /api/chat/messages', () => {
  const TOKEN = 'test-token-value';
  const headers = { authorization: `Bearer ${TOKEN}`, host: '127.0.0.1:4287' };
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

  const post = (messages: object[]) =>
    server.app.inject({ method: 'POST', url: '/api/chat/messages', headers, payload: { source: 'whatsapp', messages } });

  const now = () => new Date().toISOString();

  test('requires the pairing token', async () => {
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/chat/messages',
      headers: { host: headers.host },
      payload: { source: 'whatsapp', messages: [{ chat: 'Family', text: 'x', sentAt: now() }] },
    });
    expect(response.statusCode).toBe(401);
  });

  test('asks for mail pairing first', async () => {
    expect((await post([{ chat: 'Family', text: 'pls pay the bill', sentAt: now() }])).statusCode).toBe(409);
  });

  test('turns a watched-chat request into a WhatsApp task and announces it', async () => {
    upsertAccount(db, 'me@yahoo.com', 'yahoo');
    const events: ServerEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));

    const response = await post([
      { chat: 'Family', sender: 'Mom', text: 'Please pay ₹2,400 to Sharma ji', sentAt: now() },
      { chat: 'Family', sender: 'Mom', text: 'Good night', sentAt: now() },
    ]);
    unsubscribe();

    expect(response.json()).toEqual({ accepted: 2, skipped: 0, added: 1, linked: 0 });
    const [task] = listTasks(db, 1, { doneSince: '2000-01-01' });
    expect(task).toMatchObject({ kind: 'pay', title: 'Pay Sharma ji', amount: '₹2,400', message: null });
    expect(task?.chat).toMatchObject({ source: 'whatsapp', chatName: 'Family', sender: 'Mom' });
    expect(events).toContainEqual({ type: 'tasks:changed', added: 1, firstTitle: 'Pay Sharma ji' });
  });

  test('collapses the same message seen twice (preview, then open chat)', async () => {
    upsertAccount(db, 'me@yahoo.com', 'yahoo');
    await post([{ chat: 'Family', text: 'pls pay the bill', sentAt: now() }]);
    const again = await post([{ chat: 'family', text: '  pls pay   the bill ', sentAt: now() }]);

    expect(again.json()).toEqual({ accepted: 0, skipped: 1, added: 0, linked: 0 });
    expect(listTasks(db, 1, { doneSince: '2000-01-01' })).toHaveLength(1);
  });

  test('skips history older than a week', async () => {
    upsertAccount(db, 'me@yahoo.com', 'yahoo');
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect((await post([{ chat: 'Family', text: 'pls pay the bill', sentAt: old }])).json()).toMatchObject({
      skipped: 1,
      added: 0,
    });
  });

  test('rejects oversized batches, unknown sources and unexpected fields', async () => {
    upsertAccount(db, 'me@yahoo.com', 'yahoo');
    const many = Array.from({ length: 51 }, () => ({ chat: 'c', text: 't', sentAt: now() }));
    expect((await post(many)).statusCode).toBe(400);
    expect(
      (
        await server.app.inject({
          method: 'POST',
          url: '/api/chat/messages',
          headers,
          payload: { source: 'telegram', messages: [{ chat: 'c', text: 't', sentAt: now() }] },
        })
      ).statusCode,
    ).toBe(400);
  });
});

test('strips the invisible direction marks WhatsApp wraps text in', async () => {
  const { createServer } = await import('../src/server/app.js');
  const { createTestDatabase } = await import('../src/store/db.js');
  const { upsertAccount } = await import('../src/store/accounts.js');
  const db = createTestDatabase();
  upsertAccount(db, 'me@yahoo.com', 'yahoo');
  const session = { getStatus: () => ({}), stop: async () => {} } as unknown as MailSession;
  const server = await createServer({ db, session, token: 't', port: 4287, restartSession: async () => {}, logging: false });
  await server.app.inject({
    method: 'POST',
    url: '/api/chat/messages',
    headers: { authorization: 'Bearer t', host: '127.0.0.1:4287' },
    payload: { source: 'whatsapp', messages: [{ chat: 'Me', text: '‪pay the rent‬', sentAt: new Date().toISOString() }] },
  });
  await server.close();
  expect(db.prepare('SELECT text FROM chat_messages').get()).toEqual({ text: 'pay the rent' });
});
