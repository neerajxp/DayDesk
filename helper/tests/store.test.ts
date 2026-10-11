import { beforeEach, describe, expect, test } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDatabase } from '../src/store/db.js';
import { getAccount, upsertAccount } from '../src/store/accounts.js';
import {
  clearFolderMessages,
  getFolder,
  listFolders,
  setFloor,
  setSyncState,
  upsertFolder,
} from '../src/store/folders.js';
import {
  countMessages,
  deleteByUids,
  getBody,
  getMessageById,
  insertMessages,
  listMessages,
  listUids,
  maxUid,
  saveAttachments,
  saveBody,
  updateFlags,
  type MessageInsert,
} from '../src/store/messages.js';
import { searchMessages } from '../src/store/search.js';

function message(uid: number, overrides: Partial<MessageInsert> = {}): MessageInsert {
  return {
    uid,
    messageId: `<${uid}@example.com>`,
    subject: `Message ${uid}`,
    from: { name: 'Ada', address: 'ada@example.com' },
    to: [{ name: '', address: 'me@yahoo.com' }],
    cc: [],
    date: '2026-01-01T00:00:00.000Z',
    internalDate: new Date(Date.UTC(2026, 0, uid)).toISOString(),
    size: 1000,
    flags: [],
    isSeen: false,
    isFlagged: false,
    hasAttachments: false,
    snippet: `Snippet ${uid}`,
    ...overrides,
  };
}

describe('store', () => {
  let db: Database;
  let accountId: number;
  let inboxId: number;

  beforeEach(() => {
    db = createTestDatabase();
    const account = upsertAccount(db, 'me@yahoo.com', 'yahoo');
    accountId = account.id;
    inboxId = upsertFolder(db, accountId, 'inbox', 'INBOX').id;
    upsertFolder(db, accountId, 'sent', 'Sent');
  });

  describe('accounts', () => {
    test('stores and reads back the single account', () => {
      expect(getAccount(db)?.email).toBe('me@yahoo.com');
    });

    test('re-pairing a different address replaces the old account', () => {
      upsertAccount(db, 'other@yahoo.com', 'yahoo');

      expect(getAccount(db)?.email).toBe('other@yahoo.com');
      expect(db.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
    });

    test('re-pairing the same address is idempotent', () => {
      const first = upsertAccount(db, 'me@yahoo.com', 'yahoo');
      const second = upsertAccount(db, 'me@yahoo.com', 'yahoo');

      expect(second.id).toBe(first.id);
    });
  });

  describe('folders', () => {
    test('stores both roles', () => {
      expect(listFolders(db, accountId).map((folder) => folder.role).sort()).toEqual(['inbox', 'sent']);
    });

    test('re-discovery updates the path without duplicating the role', () => {
      upsertFolder(db, accountId, 'sent', 'Sent Items');

      expect(getFolder(db, accountId, 'sent')?.path).toBe('Sent Items');
      expect(listFolders(db, accountId)).toHaveLength(2);
    });

    test('records the floor as both uid and date', () => {
      setFloor(db, inboxId, 1501, '2025-06-01T00:00:00.000Z');

      const folder = getFolder(db, accountId, 'inbox')!;
      expect(folder.floor_uid).toBe(1501);
      expect(folder.floor_date).toBe('2025-06-01T00:00:00.000Z');
    });

    test('records sync state and stamps last_sync_at', () => {
      setSyncState(db, inboxId, { uidValidity: '999', uidNext: 50, highestModseq: '12' });

      const folder = getFolder(db, accountId, 'inbox')!;
      expect(folder.uid_validity).toBe('999');
      expect(folder.uid_next).toBe(50);
      expect(folder.last_sync_at).not.toBeNull();
    });
  });

  describe('messages', () => {
    test('inserts and counts', () => {
      const inserted = insertMessages(db, inboxId, [message(1), message(2), message(3)]);

      expect(inserted).toBe(3);
      expect(countMessages(db, inboxId)).toBe(3);
      expect(maxUid(db, inboxId)).toBe(3);
    });

    test('ignores a uid already stored, so a re-sync does not duplicate', () => {
      insertMessages(db, inboxId, [message(1), message(2)]);
      const second = insertMessages(db, inboxId, [message(2), message(3)]);

      expect(second).toBe(1);
      expect(listUids(db, inboxId)).toEqual([1, 2, 3]);
    });

    test('lists newest first', () => {
      insertMessages(db, inboxId, [message(1), message(2), message(3)]);

      const page = listMessages(db, inboxId, 'inbox', { limit: 10, offset: 0 });

      expect(page.messages.map((m) => m.uid)).toEqual([3, 2, 1]);
      expect(page.total).toBe(3);
    });

    test('paginates without losing the total', () => {
      insertMessages(db, inboxId, [message(1), message(2), message(3)]);

      const page = listMessages(db, inboxId, 'inbox', { limit: 2, offset: 2 });

      expect(page.messages.map((m) => m.uid)).toEqual([1]);
      expect(page.total).toBe(3);
    });

    test('filters to unread', () => {
      insertMessages(db, inboxId, [
        message(1, { flags: ['\\Seen'], isSeen: true }),
        message(2),
      ]);

      const page = listMessages(db, inboxId, 'inbox', { limit: 10, offset: 0, unreadOnly: true });

      expect(page.messages.map((m) => m.uid)).toEqual([2]);
      expect(page.total).toBe(1);
    });

    test('round-trips address lists through json', () => {
      insertMessages(db, inboxId, [
        message(1, { cc: [{ name: 'Grace', address: 'grace@example.com' }] }),
      ]);

      const page = listMessages(db, inboxId, 'inbox', { limit: 1, offset: 0 });

      expect(page.messages[0]!.cc).toEqual([{ name: 'Grace', address: 'grace@example.com' }]);
      expect(page.messages[0]!.from).toEqual({ name: 'Ada', address: 'ada@example.com' });
    });

    test('updates flags read from the server', () => {
      insertMessages(db, inboxId, [message(1)]);

      const changed = updateFlags(db, inboxId, [{ uid: 1, flags: ['\\Seen', '\\Flagged'] }]);

      const page = listMessages(db, inboxId, 'inbox', { limit: 1, offset: 0 });
      expect(changed).toBe(1);
      expect(page.messages[0]!.isSeen).toBe(true);
      expect(page.messages[0]!.isFlagged).toBe(true);
    });

    test('deletes by uid and drops the row from the search index', () => {
      insertMessages(db, inboxId, [message(1, { subject: 'findable needle' }), message(2)]);
      expect(searchMessages(db, accountId, 'needle', { limit: 10, offset: 0 }).total).toBe(1);

      const removed = deleteByUids(db, inboxId, [1]);

      expect(removed).toBe(1);
      expect(countMessages(db, inboxId)).toBe(1);
      // A stale FTS row would keep returning a hit that joins to nothing.
      expect(searchMessages(db, accountId, 'needle', { limit: 10, offset: 0 }).total).toBe(0);
    });

    test('deleting an absent uid is a no-op', () => {
      insertMessages(db, inboxId, [message(1)]);

      expect(deleteByUids(db, inboxId, [99])).toBe(0);
      expect(deleteByUids(db, inboxId, [])).toBe(0);
    });
  });

  describe('bodies', () => {
    test('saves and reads a body', () => {
      insertMessages(db, inboxId, [message(1)]);
      const row = getMessageById(db, 1)!;

      saveBody(db, row.id, { text: 'Hello there', html: '<p>Hello there</p>' });

      const body = getBody(db, row.id);
      expect(body?.body_text).toBe('Hello there');
      expect(body?.body_html).toBe('<p>Hello there</p>');
    });

    test('re-saving a body replaces it rather than failing', () => {
      insertMessages(db, inboxId, [message(1)]);
      const row = getMessageById(db, 1)!;

      saveBody(db, row.id, { text: 'first', html: null });
      saveBody(db, row.id, { text: 'second', html: null });

      expect(getBody(db, row.id)?.body_text).toBe('second');
    });

    test('stores attachment metadata, replacing any previous set', () => {
      insertMessages(db, inboxId, [message(1)]);
      const row = getMessageById(db, 1)!;

      saveAttachments(db, row.id, [
        { filename: 'a.pdf', contentType: 'application/pdf', size: 10, contentId: null },
      ]);
      saveAttachments(db, row.id, [
        { filename: 'b.pdf', contentType: 'application/pdf', size: 20, contentId: null },
      ]);

      const rows = db.prepare('SELECT filename FROM attachments WHERE message_id = ?').all(row.id);
      expect(rows).toEqual([{ filename: 'b.pdf' }]);
    });
  });

  describe('clearFolderMessages', () => {
    test('drops messages and the floor when UIDVALIDITY changes, keeping the date', () => {
      insertMessages(db, inboxId, [message(1, { subject: 'gone soon' }), message(2)]);
      setFloor(db, inboxId, 1, '2026-01-01T00:00:00.000Z');

      const cleared = clearFolderMessages(db, inboxId);

      expect(cleared).toBe(2);
      expect(countMessages(db, inboxId)).toBe(0);
      expect(searchMessages(db, accountId, 'gone', { limit: 10, offset: 0 }).total).toBe(0);

      const folder = getFolder(db, accountId, 'inbox')!;
      expect(folder.floor_uid).toBeNull();
      // The date survives so the window can be re-anchored after a reset.
      expect(folder.floor_date).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('cascades', () => {
    test('deleting the account removes its folders and messages', () => {
      insertMessages(db, inboxId, [message(1)]);

      db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);

      expect(db.prepare('SELECT COUNT(*) AS n FROM folders').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 });
    });
  });
});
