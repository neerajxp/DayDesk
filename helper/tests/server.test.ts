/**
 * Server integration tests.
 *
 * Exercises the real Fastify instance through inject(), with a stubbed mail
 * session so nothing touches the network. The auth hook is the security
 * boundary for the whole helper, so it is tested end-to-end rather than only
 * as units.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { FolderRole, SyncStatus } from '../src/types/mail.js';
import type { MailSession } from '../src/mail/session.js';
import { createServer, type DayDeskServer } from '../src/server/app.js';
import { createTestDatabase } from '../src/store/db.js';
import { upsertAccount } from '../src/store/accounts.js';
import { upsertFolder } from '../src/store/folders.js';
import { insertMessages, type MessageInsert } from '../src/store/messages.js';

const TOKEN = 'test-token-value';
const PORT = 4287;
const HOST = `127.0.0.1:${PORT}`;

interface SessionStub {
  bodyCalls: { messageRowId: number; role: FolderRole; uid: number }[];
  syncCalls: (FolderRole | undefined)[];
  bodyResult: 'ok' | 'gone' | 'throw';
}

function makeSession(db: Database, stub: SessionStub): MailSession {
  const session = {
    getStatus(): SyncStatus {
      return {
        accountEmail: 'me@yahoo.com',
        providerId: 'yahoo',
        providerName: 'Yahoo Mail',
        isPaired: true,
        isConnected: true,
        isSyncing: false,
        folders: [],
        lastError: null,
      };
    },
    async requestSync(role?: FolderRole): Promise<void> {
      stub.syncCalls.push(role);
    },
    async loadBody(messageRowId: number, role: FolderRole, uid: number) {
      stub.bodyCalls.push({ messageRowId, role, uid });
      if (stub.bodyResult === 'gone') return null;
      if (stub.bodyResult === 'throw') throw new Error('Not connected to Yahoo.');

      const { saveBody } = await import('../src/store/messages.js');
      saveBody(db, messageRowId, { text: 'fetched body', html: null });
      return { text: 'fetched body', html: null, attachments: [] };
    },
    async stop(): Promise<void> {},
  };
  return session as unknown as MailSession;
}

function message(uid: number, overrides: Partial<MessageInsert> = {}): MessageInsert {
  return {
    uid,
    messageId: `<${uid}@example.com>`,
    subject: `Message ${uid}`,
    from: { name: 'Ada', address: 'ada@example.com' },
    to: [],
    cc: [],
    date: '2026-01-01T00:00:00.000Z',
    internalDate: new Date(Date.UTC(2026, 0, uid)).toISOString(),
    size: 100,
    flags: [],
    isSeen: false,
    isFlagged: false,
    hasAttachments: false,
    snippet: `Snippet ${uid}`,
    ...overrides,
  };
}

describe('server', () => {
  let db: Database;
  let server: DayDeskServer;
  let stub: SessionStub;

  beforeEach(async () => {
    db = createTestDatabase();
    stub = { bodyCalls: [], syncCalls: [], bodyResult: 'ok' };

    server = await createServer({
      db,
      session: makeSession(db, stub),
      token: TOKEN,
      port: PORT,
      restartSession: async () => {},
      logging: false,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const auth = { authorization: `Bearer ${TOKEN}`, host: HOST };

  function seedAccount(): { accountId: number; inboxId: number } {
    const account = upsertAccount(db, 'me@yahoo.com', 'yahoo');
    const inbox = upsertFolder(db, account.id, 'inbox', 'INBOX');
    upsertFolder(db, account.id, 'sent', 'Sent');
    return { accountId: account.id, inboxId: inbox.id };
  }

  // ── Auth boundary ────────────────────────────────────────────────────────

  describe('authentication', () => {
    test('rejects a request with no token', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages',
        headers: { host: HOST },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('unauthorized');
    });

    test('rejects a wrong token', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages',
        headers: { authorization: 'Bearer wrong-token-value', host: HOST },
      });

      expect(response.statusCode).toBe(401);
    });

    test('rejects a non-bearer scheme', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages',
        headers: { authorization: `Basic ${TOKEN}`, host: HOST },
      });

      expect(response.statusCode).toBe(401);
    });

    test('rejects a request whose Host is not loopback, defeating DNS rebinding', async () => {
      // A malicious page on evil.example.com that resolves to 127.0.0.1 would
      // reach this server; the Host header gives it away.
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages',
        headers: { authorization: `Bearer ${TOKEN}`, host: 'evil.example.com:4287' },
      });

      expect(response.statusCode).toBe(421);
      expect(response.json().error).toBe('misdirected_request');
    });

    test('rejects a bad Host even when the token is valid', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/system/status',
        headers: { authorization: `Bearer ${TOKEN}`, host: 'attacker.test:4287' },
      });

      expect(response.statusCode).toBe(421);
    });

    test('serves the health probe without a token so the panel can tell "down" from "bad token"', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/system/health',
        headers: { host: HOST },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, service: 'daydesk-helper' });
    });

    test('still enforces loopback on the health probe', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/system/health',
        headers: { host: 'evil.example.com:4287' },
      });

      expect(response.statusCode).toBe(421);
    });

    test('does not demand an Authorization header on the WebSocket upgrade path', async () => {
      // Regression: the onRequest hook used to 401 the WS handshake before the
      // handler could check the query-param token, so live updates never
      // connected. Browsers cannot set headers on a WS handshake, so this path
      // must reach the handler, which does its own constant-time check.
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/events',
        headers: { host: HOST },
      });

      expect(response.statusCode).not.toBe(401);
    });

    test('still enforces loopback on the WebSocket upgrade path', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/events',
        headers: { host: 'evil.example.com:4287' },
      });

      expect(response.statusCode).toBe(421);
    });

    test('accepts a valid token on loopback', async () => {
      seedAccount();
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages',
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ── Listing ──────────────────────────────────────────────────────────────

  describe('GET /api/mail/messages', () => {
    test('returns 409 before pairing rather than an empty list', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages',
        headers: auth,
      });

      expect(response.statusCode).toBe(409);
    });

    test('lists inbox messages newest first', async () => {
      const { inboxId } = seedAccount();
      insertMessages(db, inboxId, [message(1), message(2), message(3)]);

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages',
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.role).toBe('inbox');
      expect(body.total).toBe(3);
      expect(body.messages.map((m: { uid: number }) => m.uid)).toEqual([3, 2, 1]);
    });

    test('rejects an unknown folder role', async () => {
      seedAccount();
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages?role=drafts',
        headers: auth,
      });

      expect(response.statusCode).toBe(400);
    });

    test('rejects a limit above the page cap', async () => {
      seedAccount();
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages?limit=5000',
        headers: auth,
      });

      expect(response.statusCode).toBe(400);
    });

    test('strips an unexpected query parameter instead of honouring it', async () => {
      // Fastify's AJV defaults include removeAdditional, so an unknown param is
      // dropped rather than rejected. Either behaviour is safe; this pins which
      // one we actually get, so a future AJV config change is visible here.
      const { inboxId } = seedAccount();
      insertMessages(db, inboxId, [message(1)]);

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages?role=inbox&unreadOnly=true&sneaky=1',
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
      // The legitimate params still applied; the unknown one had no effect.
      expect(response.json().total).toBe(1);
    });
  });

  // ── Detail and lazy body loading ─────────────────────────────────────────

  describe('GET /api/mail/messages/:id', () => {
    test('fetches the body on a cache miss and returns it', async () => {
      const { inboxId } = seedAccount();
      insertMessages(db, inboxId, [message(1)]);
      const row = db.prepare('SELECT id FROM messages WHERE uid = 1').get() as { id: number };

      const response = await server.app.inject({
        method: 'GET',
        url: `/api/mail/messages/${row.id}`,
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().bodyText).toBe('fetched body');
      expect(stub.bodyCalls).toEqual([{ messageRowId: row.id, role: 'inbox', uid: 1 }]);
    });

    test('does not hit the network on a cache hit', async () => {
      const { inboxId } = seedAccount();
      insertMessages(db, inboxId, [message(1)]);
      const row = db.prepare('SELECT id FROM messages WHERE uid = 1').get() as { id: number };

      await server.app.inject({ method: 'GET', url: `/api/mail/messages/${row.id}`, headers: auth });
      await server.app.inject({ method: 'GET', url: `/api/mail/messages/${row.id}`, headers: auth });

      expect(stub.bodyCalls).toHaveLength(1);
    });

    test('returns 410 when the message has vanished from the server', async () => {
      const { inboxId } = seedAccount();
      insertMessages(db, inboxId, [message(1)]);
      const row = db.prepare('SELECT id FROM messages WHERE uid = 1').get() as { id: number };
      stub.bodyResult = 'gone';

      const response = await server.app.inject({
        method: 'GET',
        url: `/api/mail/messages/${row.id}`,
        headers: auth,
      });

      expect(response.statusCode).toBe(410);
    });

    test('returns 503 when the fetch fails, not 500', async () => {
      const { inboxId } = seedAccount();
      insertMessages(db, inboxId, [message(1)]);
      const row = db.prepare('SELECT id FROM messages WHERE uid = 1').get() as { id: number };
      stub.bodyResult = 'throw';

      const response = await server.app.inject({
        method: 'GET',
        url: `/api/mail/messages/${row.id}`,
        headers: auth,
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().message).toMatch(/Not connected/);
    });

    test('returns 404 for an unknown id', async () => {
      seedAccount();
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages/99999',
        headers: auth,
      });

      expect(response.statusCode).toBe(404);
    });

    test('rejects a non-numeric id', async () => {
      seedAccount();
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/messages/not-a-number',
        headers: auth,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── Search ───────────────────────────────────────────────────────────────

  describe('GET /api/mail/search', () => {
    test('returns matching messages', async () => {
      const { inboxId } = seedAccount();
      insertMessages(db, inboxId, [message(1, { subject: 'Quarterly invoice' }), message(2)]);

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/search?q=invoice',
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(1);
    });

    test('requires a query', async () => {
      seedAccount();
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/mail/search',
        headers: auth,
      });

      expect(response.statusCode).toBe(400);
    });

    test('returns empty rather than erroring on a query of only operator characters', async () => {
      const { inboxId } = seedAccount();
      insertMessages(db, inboxId, [message(1)]);

      const response = await server.app.inject({
        method: 'GET',
        url: `/api/mail/search?q=${encodeURIComponent('*** ((')}`,
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(0);
    });
  });

  // ── Sync and pairing ─────────────────────────────────────────────────────

  describe('POST /api/mail/sync', () => {
    test('triggers a sync for all folders by default', async () => {
      seedAccount();
      const response = await server.app.inject({ method: 'POST', url: '/api/mail/sync', headers: auth });

      expect(response.statusCode).toBe(200);
      expect(stub.syncCalls).toEqual([undefined]);
    });

    test('triggers a sync for a single role', async () => {
      seedAccount();
      await server.app.inject({
        method: 'POST',
        url: '/api/mail/sync',
        headers: auth,
        payload: { role: 'sent' },
      });

      expect(stub.syncCalls).toEqual(['sent']);
    });

    test('rejects an unknown role', async () => {
      seedAccount();
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/mail/sync',
        headers: auth,
        payload: { role: 'trash' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('pairing', () => {
    test('rejects a pair request with a malformed email', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/system/pair',
        headers: auth,
        payload: { email: 'not-an-email', appPassword: 'abcd' },
      });

      expect(response.statusCode).toBe(400);
    });

    test('rejects a pair request with no app password', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/system/pair',
        headers: auth,
        payload: { email: 'me@yahoo.com' },
      });

      expect(response.statusCode).toBe(400);
    });

    test('rejects an unknown provider before touching the network', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/system/pair',
        headers: auth,
        payload: { email: 'me@yahoo.com', appPassword: 'abcd', providerId: 'hotmail' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('unknown_provider');
    });

    test('does not reuse 401 for a rejected Yahoo credential', async () => {
      // Regression: the pair route used to answer 401 when Yahoo rejected the
      // app password. The client maps any 401 to "the pairing token was
      // rejected", so a wrong address or password was reported as a token
      // problem and Yahoo's real explanation was discarded. 401 must mean
      // one thing only: the caller is not authenticated to the helper.
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/system/pair',
        headers: auth,
        // A syntactically valid but unknown provider fails before any network
        // call, which is enough to assert the status code is not 401.
        payload: { email: 'someone@yahoo.com', appPassword: 'wrong', providerId: 'nope' },
      });

      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).toBe(400);
    });

    test('reports 404 when unpairing with nothing paired', async () => {
      const response = await server.app.inject({
        method: 'DELETE',
        url: '/api/system/pair',
        headers: auth,
      });

      expect(response.statusCode).toBe(404);
    });

    test('lists providers for the pairing UI', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/system/providers',
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        expect.objectContaining({ id: 'yahoo', displayName: 'Yahoo Mail', maxMessagesPerFolder: 10_000 }),
        expect.objectContaining({ id: 'gmail', displayName: 'Gmail', maxMessagesPerFolder: null }),
      ]);
    });
  });

  describe('GET /api/system/status', () => {
    test('reports the session status', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/system/status',
        headers: auth,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ isPaired: true, accountEmail: 'me@yahoo.com' });
    });
  });
});
