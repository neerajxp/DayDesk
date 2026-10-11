/**
 * Credential storage, backed by the OS keychain.
 *
 * The app password lives here and nowhere else — not in the database, not in
 * config, never sent to the extension. This matters: an app-encrypted file
 * whose key is derivable by any process running as you is obfuscation, not
 * security. The keychain is a real boundary because the OS gates access to it.
 *
 * Uses @napi-rs/keyring; node-keytar was archived in Dec 2022 and will not
 * receive further security fixes.
 */

import { Entry } from '@napi-rs/keyring';

const SERVICE = 'DayDesk';

function entryFor(email: string): Entry {
  return new Entry(SERVICE, email);
}

export function saveAppPassword(email: string, appPassword: string): void {
  entryFor(email).setPassword(appPassword);
}

/** Returns null when no credential is stored (rather than throwing). */
export function getAppPassword(email: string): string | null {
  try {
    return entryFor(email).getPassword();
  } catch {
    return null;
  }
}

/** Returns true if a credential existed and was removed. */
export function deleteAppPassword(email: string): boolean {
  try {
    return entryFor(email).deletePassword();
  } catch {
    return false;
  }
}
