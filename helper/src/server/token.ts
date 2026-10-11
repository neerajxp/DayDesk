/**
 * Pairing token.
 *
 * Every website you visit can issue requests to http://127.0.0.1:<port>. CORS
 * stops a malicious page reading the *response*, but the request is still sent
 * and any side effect still happens — so CORS is not an access control. The
 * token is.
 *
 * Generated once on first run and written to ~/.daydesk/token with 0600. You
 * paste it into the side panel once to pair.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { PATHS, ensureDirectories } from '../config/paths.js';

const TOKEN_BYTES = 32;

/** Read the existing token, creating one if this is the first run. */
export function loadOrCreateToken(): string {
  ensureDirectories();

  try {
    const existing = readFileSync(PATHS.token, 'utf8').trim();
    if (existing.length > 0) {
      // Repair permissions in case the file was created by an older version.
      chmodSync(PATHS.token, 0o600);
      return existing;
    }
  } catch {
    // No token yet.
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  writeFileSync(PATHS.token, `${token}\n`, { mode: 0o600 });
  return token;
}

/**
 * Constant-time comparison.
 *
 * A plain `===` on a secret leaks its prefix through response timing, which is
 * enough to recover it byte by byte from a local attacker.
 */
export function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract a bearer token from an Authorization header. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}
