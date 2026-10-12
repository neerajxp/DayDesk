import { describe, expect, test } from 'vitest';
import { getProvider, listProviderIds } from '../src/providers/index.js';
import { describeImapError } from '../src/mail/client.js';

describe('providers', () => {
  test('offers Yahoo and Gmail', () => {
    expect(listProviderIds()).toEqual(['yahoo', 'gmail']);
  });

  test('Gmail connects to Google over TLS and finds its Sent folder by name if needed', () => {
    const gmail = getProvider('gmail');
    expect(gmail.imap).toEqual({ host: 'imap.gmail.com', port: 993, secure: true });
    expect(gmail.folderNameHints.sent).toContain('[Gmail]/Sent Mail');
    expect(gmail.capabilities.maxMessagesPerFolder).toBeNull();
  });

  test('rejects an unknown provider', () => {
    expect(() => getProvider('hotmail')).toThrow(/Unknown mail provider/);
  });
});

describe('describeImapError names the provider in use', () => {
  const authFailure = Object.assign(new Error('Command failed'), { authenticationFailed: true });
  const offline = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });

  test('Gmail', () => {
    const gmail = getProvider('gmail');
    expect(describeImapError(authFailure, gmail)).toMatch(/^Gmail rejected the credentials.*Gmail app password/);
    expect(describeImapError(offline, gmail)).toBe('Could not reach imap.gmail.com. Check your network connection.');
  });

  test('Yahoo', () => {
    expect(describeImapError(authFailure, getProvider('yahoo'))).toMatch(/^Yahoo Mail rejected the credentials/);
  });

  test('stays neutral when the provider is unknown', () => {
    expect(describeImapError(authFailure)).toMatch(/^Your mail provider rejected the credentials/);
  });
});
