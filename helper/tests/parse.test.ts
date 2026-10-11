import { describe, expect, test } from 'vitest';
import {
  detectAttachments,
  makeSnippet,
  toMailAddress,
  toMailAddresses,
  toMessageInsert,
} from '../src/mail/parse.js';

describe('toMailAddress', () => {
  test('maps a name and address', () => {
    expect(toMailAddress({ name: 'Ada Lovelace', address: 'ada@example.com' })).toEqual({
      name: 'Ada Lovelace',
      address: 'ada@example.com',
    });
  });

  test('defaults a missing name to an empty string rather than undefined', () => {
    expect(toMailAddress({ address: 'ada@example.com' })).toEqual({
      name: '',
      address: 'ada@example.com',
    });
  });

  test('returns null when there is no address to key on', () => {
    expect(toMailAddress({ name: 'Nobody' })).toBeNull();
    expect(toMailAddress({ address: '   ' })).toBeNull();
    expect(toMailAddress(undefined)).toBeNull();
  });
});

describe('toMailAddresses', () => {
  test('drops entries with no address instead of emitting nulls', () => {
    const result = toMailAddresses([
      { address: 'a@example.com' },
      { name: 'Broken' },
      { address: 'b@example.com' },
    ]);

    expect(result).toEqual([
      { name: '', address: 'a@example.com' },
      { name: '', address: 'b@example.com' },
    ]);
  });

  test('returns an empty list for a missing header', () => {
    expect(toMailAddresses(undefined)).toEqual([]);
  });
});

describe('detectAttachments', () => {
  test('finds an attachment nested in a multipart tree', () => {
    const structure = {
      type: 'multipart/mixed',
      childNodes: [
        { type: 'text/plain' },
        {
          type: 'multipart/alternative',
          childNodes: [{ type: 'application/pdf', disposition: 'attachment' }],
        },
      ],
    };

    expect(detectAttachments(structure)).toBe(true);
  });

  test('does not count inline parts, so embedded images show no paperclip', () => {
    const structure = {
      type: 'multipart/related',
      childNodes: [
        { type: 'text/html' },
        { type: 'image/png', disposition: 'inline' },
      ],
    };

    expect(detectAttachments(structure)).toBe(false);
  });

  test('is case-insensitive about the disposition value', () => {
    expect(detectAttachments({ disposition: 'ATTACHMENT' })).toBe(true);
  });

  test('handles a missing body structure', () => {
    expect(detectAttachments(undefined)).toBe(false);
  });
});

describe('makeSnippet', () => {
  test('collapses runs of whitespace into single spaces', () => {
    expect(makeSnippet('hello\n\n   world\t\tagain')).toBe('hello world again');
  });

  test('truncates with an ellipsis past the limit', () => {
    const result = makeSnippet('a'.repeat(300), 50);

    expect(result).toHaveLength(50);
    expect(result.endsWith('…')).toBe(true);
  });

  test('leaves short text untouched', () => {
    expect(makeSnippet('short', 50)).toBe('short');
  });

  test('returns an empty string for absent text', () => {
    expect(makeSnippet(null)).toBe('');
    expect(makeSnippet(undefined)).toBe('');
  });
});

describe('toMessageInsert', () => {
  test('maps a complete fetch result', () => {
    const result = toMessageInsert({
      uid: 42,
      size: 2048,
      internalDate: new Date('2026-01-15T10:30:00Z'),
      flags: new Set(['\\Seen', '\\Flagged']),
      envelope: {
        date: new Date('2026-01-15T10:29:00Z'),
        subject: 'Quarterly numbers',
        messageId: '<abc@example.com>',
        from: [{ name: 'Ada', address: 'ada@example.com' }],
        to: [{ address: 'me@yahoo.com' }],
        cc: [],
      },
      bodyStructure: { type: 'text/plain' },
    });

    expect(result.uid).toBe(42);
    expect(result.subject).toBe('Quarterly numbers');
    expect(result.from).toEqual({ name: 'Ada', address: 'ada@example.com' });
    expect(result.isSeen).toBe(true);
    expect(result.isFlagged).toBe(true);
    expect(result.hasAttachments).toBe(false);
    expect(result.internalDate).toBe('2026-01-15T10:30:00.000Z');
    expect(result.date).toBe('2026-01-15T10:29:00.000Z');
  });

  test('survives an envelope with nothing in it', () => {
    // Mail headers are attacker-controlled; a message with no envelope at all
    // must not throw and must not land with a null sort key.
    const result = toMessageInsert({ uid: 7 });

    expect(result.uid).toBe(7);
    expect(result.subject).toBe('');
    expect(result.from).toBeNull();
    expect(result.to).toEqual([]);
    expect(result.flags).toEqual([]);
    expect(result.isSeen).toBe(false);
    expect(result.internalDate).not.toBeNull();
    expect(Number.isNaN(Date.parse(result.internalDate))).toBe(false);
  });

  test('falls back to the envelope date when internalDate is absent', () => {
    const result = toMessageInsert({
      uid: 8,
      envelope: { date: new Date('2026-02-02T00:00:00Z') },
    });

    expect(result.internalDate).toBe('2026-02-02T00:00:00.000Z');
  });

  test('ignores an unparseable date rather than storing Invalid Date', () => {
    const result = toMessageInsert({
      uid: 9,
      internalDate: 'not a date',
      envelope: { date: 'also not a date' },
    });

    expect(result.date).toBeNull();
    expect(Number.isNaN(Date.parse(result.internalDate))).toBe(false);
  });

  test('accepts flags as an array as well as a Set', () => {
    const result = toMessageInsert({ uid: 10, flags: ['\\Seen'] });

    expect(result.isSeen).toBe(true);
  });
});
