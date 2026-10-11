import { describe, expect, test } from 'vitest';
import type { Database } from 'better-sqlite3';
import { buildMatchExpression, searchMessages } from '../src/store/search.js';
import { createTestDatabase } from '../src/store/db.js';
import { upsertAccount } from '../src/store/accounts.js';
import { upsertFolder } from '../src/store/folders.js';
import { insertMessages, saveBody, type MessageInsert } from '../src/store/messages.js';

describe('buildMatchExpression', () => {
  test('quotes each term and combines with AND', () => {
    expect(buildMatchExpression('invoice march', { prefixLastTerm: false })).toBe('"invoice" AND "march"');
  });

  test('adds a prefix wildcard to the last term for type-ahead', () => {
    expect(buildMatchExpression('invo')).toBe('"invo"*');
  });

  test('neutralises FTS5 operator keywords by quoting them as literals', () => {
    // Unquoted, "OR" would be an operator and change the meaning of the query.
    expect(buildMatchExpression('cats OR dogs', { prefixLastTerm: false })).toBe(
      '"cats" AND "OR" AND "dogs"',
    );
  });

  test('strips characters that carry meaning in the FTS5 grammar', () => {
    expect(buildMatchExpression('a*b(c)d:e^f', { prefixLastTerm: false })).toBe('"abcdef"');
  });

  test('escapes embedded double quotes by doubling them', () => {
    // A lone quote would otherwise terminate the string literal early.
    const result = buildMatchExpression('say"hello', { prefixLastTerm: false });

    expect(result).toBe('"sayhello"');
  });

  test('returns null when there is nothing searchable', () => {
    expect(buildMatchExpression('')).toBeNull();
    expect(buildMatchExpression('    ')).toBeNull();
    expect(buildMatchExpression('*** ((( )))')).toBeNull();
  });

  test('does not let a hyphen become a NOT operator', () => {
    expect(buildMatchExpression('-urgent', { prefixLastTerm: false })).toBe('"urgent"');
  });
});

describe('searchMessages', () => {
  function seed(): { db: Database; accountId: number } {
    const db = createTestDatabase();
    const account = upsertAccount(db, 'me@yahoo.com', 'yahoo');
    const inbox = upsertFolder(db, account.id, 'inbox', 'INBOX');
    const sent = upsertFolder(db, account.id, 'sent', 'Sent');

    const message = (uid: number, subject: string, from: string): MessageInsert => ({
      uid,
      messageId: `<${uid}@example.com>`,
      subject,
      from: { name: from, address: `${from.toLowerCase()}@example.com` },
      to: [],
      cc: [],
      date: '2026-01-01T00:00:00.000Z',
      internalDate: `2026-01-0${uid}T00:00:00.000Z`,
      size: 100,
      flags: [],
      isSeen: false,
      isFlagged: false,
      hasAttachments: false,
      snippet: subject,
    });

    insertMessages(db, inbox.id, [
      message(1, 'Quarterly invoice attached', 'Ada'),
      message(2, 'Lunch tomorrow?', 'Grace'),
    ]);
    insertMessages(db, sent.id, [message(3, 'Re: Quarterly invoice', 'Me')]);

    return { db, accountId: account.id };
  }

  test('matches on subject', () => {
    const { db, accountId } = seed();

    const result = searchMessages(db, accountId, 'invoice', { limit: 10, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.hits.map((hit) => hit.subject).sort()).toEqual([
      'Quarterly invoice attached',
      'Re: Quarterly invoice',
    ]);
  });

  test('matches on sender name', () => {
    const { db, accountId } = seed();

    const result = searchMessages(db, accountId, 'Grace', { limit: 10, offset: 0 });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.subject).toBe('Lunch tomorrow?');
  });

  test('scopes results to one folder role when asked', () => {
    const { db, accountId } = seed();

    const result = searchMessages(db, accountId, 'invoice', { limit: 10, offset: 0, role: 'sent' });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.folderRole).toBe('sent');
  });

  test('matches body text once a body has been fetched', () => {
    const { db, accountId } = seed();

    // Before the body is cached, a body-only term finds nothing.
    expect(searchMessages(db, accountId, 'pangolin', { limit: 10, offset: 0 }).total).toBe(0);

    const target = db.prepare('SELECT id FROM messages WHERE uid = 2').get() as { id: number };
    saveBody(db, target.id, { text: 'Shall we discuss the pangolin report?', html: null });

    const result = searchMessages(db, accountId, 'pangolin', { limit: 10, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.hits[0]!.subject).toBe('Lunch tomorrow?');
  });

  test('returns no results for an unsearchable query rather than matching everything', () => {
    const { db, accountId } = seed();

    const result = searchMessages(db, accountId, '***', { limit: 10, offset: 0 });

    expect(result.total).toBe(0);
    expect(result.hits).toEqual([]);
  });

  test('respects limit and offset', () => {
    const { db, accountId } = seed();

    const page = searchMessages(db, accountId, 'invoice', { limit: 1, offset: 0 });

    expect(page.hits).toHaveLength(1);
    expect(page.total).toBe(2);
  });
});
