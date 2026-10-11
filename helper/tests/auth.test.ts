import { describe, expect, test } from 'vitest';
import { isLoopbackHost } from '../src/server/auth.js';
import { parseBearer, tokensMatch } from '../src/server/token.js';

describe('isLoopbackHost', () => {
  test('accepts the loopback forms on the configured port', () => {
    expect(isLoopbackHost('127.0.0.1:4287', 4287)).toBe(true);
    expect(isLoopbackHost('localhost:4287', 4287)).toBe(true);
    expect(isLoopbackHost('[::1]:4287', 4287)).toBe(true);
  });

  test('rejects an attacker hostname that resolves to loopback', () => {
    // This is the DNS rebinding case: the page's requests arrive here, but the
    // browser sends the attacker's hostname in Host.
    expect(isLoopbackHost('evil.example.com:4287', 4287)).toBe(false);
    expect(isLoopbackHost('daydesk.attacker.io:4287', 4287)).toBe(false);
  });

  test('rejects a mismatched port', () => {
    expect(isLoopbackHost('127.0.0.1:9999', 4287)).toBe(false);
  });

  test('rejects a missing Host header', () => {
    expect(isLoopbackHost(undefined, 4287)).toBe(false);
  });

  test('is case-insensitive, since Host casing is not significant', () => {
    expect(isLoopbackHost('LOCALHOST:4287', 4287)).toBe(true);
  });
});

describe('parseBearer', () => {
  test('extracts the token', () => {
    expect(parseBearer('Bearer abc123')).toBe('abc123');
  });

  test('accepts any casing of the scheme', () => {
    expect(parseBearer('bearer abc123')).toBe('abc123');
    expect(parseBearer('BEARER abc123')).toBe('abc123');
  });

  test('returns null for a missing or malformed header', () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('')).toBeNull();
    expect(parseBearer('Basic abc123')).toBeNull();
    expect(parseBearer('Bearer')).toBeNull();
  });
});

describe('tokensMatch', () => {
  test('matches an identical token', () => {
    expect(tokensMatch('s3cret-token', 's3cret-token')).toBe(true);
  });

  test('rejects a different token', () => {
    expect(tokensMatch('s3cret-token', 'wrong-token')).toBe(false);
  });

  test('rejects a token that is merely a prefix', () => {
    expect(tokensMatch('s3cret-token', 's3cret')).toBe(false);
  });

  test('rejects an empty provided token', () => {
    expect(tokensMatch('s3cret-token', '')).toBe(false);
  });
});
