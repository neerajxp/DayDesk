/**
 * Folder discovery.
 *
 * Resolves the logical roles DayDesk cares about (inbox, sent) to real mailbox
 * paths. Prefers the IMAP SPECIAL-USE attributes (\Sent, \Inbox) over matching
 * on folder names, because names are localised and provider-specific — "Sent",
 * "Sent Items" and "Sent Messages" are all in the wild. Name hints from the
 * provider preset are the fallback when the server reports no SPECIAL-USE.
 */

import type { ImapFlow } from 'imapflow';
import type { MailProvider } from '../providers/types.js';
import type { FolderRole } from '../types/mail.js';

/** The subset of an imapflow list entry that discovery reads. */
export interface RawMailbox {
  readonly path: string;
  readonly name?: string | undefined;
  readonly specialUse?: string | undefined;
  readonly flags?: ReadonlySet<string> | readonly string[] | undefined;
}

export type DiscoveredFolders = Readonly<Record<FolderRole, string>>;

function hasFlag(mailbox: RawMailbox, flag: string): boolean {
  if (mailbox.specialUse === flag) return true;
  if (!mailbox.flags) return false;
  const flags = Array.isArray(mailbox.flags) ? mailbox.flags : [...mailbox.flags];
  return flags.includes(flag);
}

/**
 * Pick the mailbox paths for inbox and sent from a LIST response.
 *
 * Pure so it can be tested against real-world LIST shapes without a server.
 * Throws when Sent cannot be resolved at all, because silently syncing only the
 * inbox would look like a bug with no explanation.
 */
export function resolveFolders(mailboxes: readonly RawMailbox[], provider: MailProvider): DiscoveredFolders {
  const inbox =
    mailboxes.find((mailbox) => mailbox.path.toUpperCase() === 'INBOX') ??
    mailboxes.find((mailbox) => hasFlag(mailbox, '\\Inbox'));

  if (!inbox) {
    throw new Error('Could not find an INBOX on this account.');
  }

  const sentBySpecialUse = mailboxes.find((mailbox) => hasFlag(mailbox, '\\Sent'));

  const sentByName = provider.folderNameHints.sent
    .map((hint) => mailboxes.find((mailbox) => mailbox.path.toLowerCase() === hint.toLowerCase()))
    .find((match): match is RawMailbox => match !== undefined);

  const sent = sentBySpecialUse ?? sentByName;

  if (!sent) {
    const available = mailboxes.map((mailbox) => mailbox.path).join(', ');
    throw new Error(
      `Could not identify the Sent folder. The server reported no \\Sent special-use flag and none of ` +
        `${provider.folderNameHints.sent.join(', ')} matched. Available mailboxes: ${available}`,
    );
  }

  return { inbox: inbox.path, sent: sent.path };
}

export async function discoverFolders(
  client: ImapFlow,
  provider: MailProvider,
): Promise<DiscoveredFolders> {
  const mailboxes = (await client.list()) as unknown as RawMailbox[];
  return resolveFolders(mailboxes, provider);
}
