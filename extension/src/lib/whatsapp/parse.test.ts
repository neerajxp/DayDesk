import { describe, expect, test } from 'vitest';
import { isPhoneEntry, isWatched, parseDataId, parseListTime, parsePrePlainText, phoneFromJid } from './parse.js';

describe('parseDataId', () => {
  test('reads direction and chat from a one-to-one message id', () => {
    expect(parseDataId('false_919876543210@c.us_3EB0C4A1B2')).toEqual({ isFromMe: false, chatJid: '919876543210@c.us' });
  });

  test('reads a group message id that carries a participant', () => {
    expect(parseDataId('true_120363041234567890@g.us_ABCD_919876543210@c.us')).toEqual({
      isFromMe: true,
      chatJid: '120363041234567890@g.us',
    });
  });

  test('rejects anything else', () => {
    expect(parseDataId('album-123')).toBeNull();
  });
});

test('phoneFromJid only yields digits for one-to-one chats', () => {
  expect(phoneFromJid('919876543210@c.us')).toBe('919876543210');
  expect(phoneFromJid('120363041234567890@g.us')).toBeNull();
  expect(phoneFromJid('123456789@lid')).toBeNull();
});

describe('parsePrePlainText', () => {
  test('reads a US-format timestamp and sender', () => {
    const { sentAt, sender } = parsePrePlainText('[10:32 PM, 10/11/2026] Mom: ', 'en-US');
    expect(sender).toBe('Mom');
    expect(sentAt).toEqual(new Date(2026, 9, 11, 22, 32));
  });

  test('reads day-first dates outside the US', () => {
    expect(parsePrePlainText('[22:32, 11/10/2026] Mom: ', 'en-IN').sentAt).toEqual(new Date(2026, 9, 11, 22, 32));
  });

  test('a part above 12 decides the order whatever the locale', () => {
    expect(parsePrePlainText('[9:05 am, 25/10/2026] Priya: ', 'en-US').sentAt).toEqual(new Date(2026, 9, 25, 9, 5));
  });

  test('keeps colons inside the sender name intact and handles 12 AM', () => {
    expect(parsePrePlainText('[12:15 AM, 10/11/2026] +91 98765 43210: ', 'en-US')).toEqual({
      sentAt: new Date(2026, 9, 11, 0, 15),
      sender: '+91 98765 43210',
    });
  });

  test('falls back gracefully on an unknown shape', () => {
    expect(parsePrePlainText('garbage', 'en-US')).toEqual({ sentAt: null, sender: '' });
  });
});

describe('watch list', () => {
  test('recognises phone-number entries', () => {
    expect(isPhoneEntry('+91 98765 43210')).toBe(true);
    expect(isPhoneEntry('Family')).toBe(false);
    expect(isPhoneEntry('123')).toBe(false);
  });

  test('matches group and contact names exactly, ignoring case', () => {
    expect(isWatched(['Family'], { title: 'family', jid: null })).toBe(true);
    expect(isWatched(['Family'], { title: 'Family Friends', jid: null })).toBe(false);
  });

  test('matches a number against an unsaved contact title', () => {
    expect(isWatched(['9876543210'], { title: '+91 98765 43210', jid: null })).toBe(true);
  });

  test('matches a number against a saved contact through its chat id', () => {
    expect(isWatched(['+91 98765 43210'], { title: 'Ramesh Accountant', jid: '919876543210@c.us' })).toBe(true);
    expect(isWatched(['+91 98765 43211'], { title: 'Ramesh Accountant', jid: '919876543210@c.us' })).toBe(false);
  });

  test('an empty list watches nothing', () => {
    expect(isWatched([], { title: 'Family', jid: null })).toBe(false);
  });
});

test('your own chat matches without the "(You)" label', () => {
  expect(isWatched(['Neeraj Maurya'], { title: 'Neeraj Maurya (You)', jid: null })).toBe(true);
  expect(isWatched(['Neeraj Maurya (You)'], { title: 'Neeraj Maurya', jid: null })).toBe(true);
});

describe('parseListTime', () => {
  const now = new Date(2026, 9, 11, 21, 0);

  test('pins a clock time to today and "Yesterday" to yesterday', () => {
    expect(parseListTime('9:42 PM', now)).toEqual(new Date(2026, 9, 11, 21, 42));
    expect(parseListTime('21:42', now)).toEqual(new Date(2026, 9, 11, 21, 42));
    expect(parseListTime('Yesterday', now)).toEqual(new Date(2026, 9, 10, 12, 0));
  });

  test('treats older labels as not news', () => {
    expect(parseListTime('Friday', now)).toBeNull();
    expect(parseListTime('10/09/2026', now)).toBeNull();
  });
});
