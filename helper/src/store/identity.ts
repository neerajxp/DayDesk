/**
 * Who "you" are, so the board can stop telling you that you sent yourself a
 * reminder.
 *
 * Learned, not configured: the paired account address, plus every address
 * and display name on your Sent mail. The name is what catches your other
 * accounts (a Gmail address sending to this inbox) and your own WhatsApp
 * chat, which WhatsApp titles with that same name.
 */

import type { Database } from 'better-sqlite3';

export interface SelfIdentity {
  readonly addresses: ReadonlySet<string>;
  readonly names: ReadonlySet<string>;
}

export const NO_IDENTITY: SelfIdentity = { addresses: new Set(), names: new Set() };

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function loadSelfIdentity(db: Database, accountId: number): SelfIdentity {
  const account = db.prepare('SELECT email FROM accounts WHERE id = ?').get(accountId) as { email: string } | undefined;
  const rows = db
    .prepare(
      `SELECT DISTINCT m.from_addr, m.from_name
       FROM messages m JOIN folders f ON f.id = m.folder_id
       WHERE f.account_id = ? AND f.role = 'sent'`,
    )
    .all(accountId) as { from_addr: string; from_name: string }[];

  const addresses = new Set<string>(account ? [normalize(account.email)] : []);
  const names = new Set<string>();
  for (const row of rows) {
    if (row.from_addr) addresses.add(normalize(row.from_addr));
    if (row.from_name) names.add(normalize(row.from_name));
  }
  return { addresses, names };
}

/** True when a sender (email or chat) is you. "You" is WhatsApp's own label for your messages. */
export function isSelf(identity: SelfIdentity, sender: { name?: string; address?: string }): boolean {
  const name = sender.name ? normalize(sender.name) : '';
  const address = sender.address ? normalize(sender.address) : '';
  return (
    name === 'you' ||
    (address !== '' && identity.addresses.has(address)) ||
    (name !== '' && identity.names.has(name))
  );
}
