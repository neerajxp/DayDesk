import { describe, expect, test } from 'vitest';
import { resolveFolders, type RawMailbox } from '../src/mail/discover.js';
import { YAHOO } from '../src/providers/yahoo.js';

describe('resolveFolders', () => {
  test('prefers the \\Sent special-use flag over folder names', () => {
    const mailboxes: RawMailbox[] = [
      { path: 'INBOX' },
      { path: 'Sent', flags: ['\\Noselect'] },
      { path: 'Archive/Outgoing', specialUse: '\\Sent' },
    ];

    const result = resolveFolders(mailboxes, YAHOO);

    expect(result.inbox).toBe('INBOX');
    // Special-use wins even though a folder literally called "Sent" exists.
    expect(result.sent).toBe('Archive/Outgoing');
  });

  test('falls back to provider name hints when no special-use is reported', () => {
    const mailboxes: RawMailbox[] = [{ path: 'INBOX' }, { path: 'Sent' }, { path: 'Draft' }];

    expect(resolveFolders(mailboxes, YAHOO).sent).toBe('Sent');
  });

  test('matches a name hint case-insensitively', () => {
    const mailboxes: RawMailbox[] = [{ path: 'INBOX' }, { path: 'sent items' }];

    expect(resolveFolders(mailboxes, YAHOO).sent).toBe('sent items');
  });

  test('finds the inbox regardless of case', () => {
    const mailboxes: RawMailbox[] = [{ path: 'Inbox' }, { path: 'Sent' }];

    expect(resolveFolders(mailboxes, YAHOO).inbox).toBe('Inbox');
  });

  test('reads special-use from the flags set as well as the specialUse field', () => {
    const mailboxes: RawMailbox[] = [
      { path: 'INBOX' },
      { path: 'Elsewhere', flags: new Set(['\\Sent']) },
    ];

    expect(resolveFolders(mailboxes, YAHOO).sent).toBe('Elsewhere');
  });

  test('throws a diagnostic error when Sent cannot be identified', () => {
    // Silently syncing only the inbox would look like a bug with no explanation,
    // so this fails loudly and lists what the server actually offered.
    const mailboxes: RawMailbox[] = [{ path: 'INBOX' }, { path: 'Bulk' }];

    expect(() => resolveFolders(mailboxes, YAHOO)).toThrow(/Could not identify the Sent folder/);
    expect(() => resolveFolders(mailboxes, YAHOO)).toThrow(/Bulk/);
  });

  test('throws when there is no inbox at all', () => {
    expect(() => resolveFolders([{ path: 'Sent' }], YAHOO)).toThrow(/Could not find an INBOX/);
  });
});
