/**
 * IMAP connection management.
 *
 * DayDesk is strictly read-only. That is enforced here in two ways:
 *   1. Mailboxes are opened with readOnly: true, which issues EXAMINE rather
 *      than SELECT. An EXAMINE'd mailbox will not accept flag changes, and the
 *      server must not set \Seen as a side effect of a body fetch.
 *   2. Bodies are fetched through BODY.PEEK[] (imapflow's `source` option under
 *      a read-only mailbox), which never implicitly marks mail as read.
 *
 * There is no code path in DayDesk that issues STORE, APPEND, EXPUNGE or COPY.
 */

import { ImapFlow, type MailboxObject } from 'imapflow';
import type { MailProvider } from '../providers/types.js';

export interface ConnectionOptions {
  readonly provider: MailProvider;
  readonly email: string;
  readonly appPassword: string;
  /** Surface protocol chatter for debugging. Logs can include header content. */
  readonly verbose?: boolean;
}

export function createClient(options: ConnectionOptions): ImapFlow {
  return new ImapFlow({
    host: options.provider.imap.host,
    port: options.provider.imap.port,
    secure: options.provider.imap.secure,
    auth: {
      user: options.email,
      pass: options.appPassword,
    },
    logger: options.verbose ? undefined : false,
    // Providers (Yahoo especially) are strict about client identification; a
    // missing ID is sometimes met with throttling.
    clientInfo: {
      name: 'DayDesk',
      version: '0.1.0',
    },
  });
}

/**
 * Connect, verify credentials, and disconnect.
 *
 * Used by the pairing flow so a bad app password fails immediately with a clear
 * message rather than surfacing as a mysterious sync failure later.
 */
export async function verifyCredentials(
  options: ConnectionOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = createClient(options);
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeImapError(error, options.provider) };
  } finally {
    // logout() already closes on the happy path; this covers the failure path.
    if (client.usable) client.close();
  }
}

/**
 * Open a mailbox read-only and run a function against it, always releasing the
 * lock. imapflow serialises commands per connection via this lock, so holding
 * it for the duration of a batch keeps concurrent syncs from interleaving.
 *
 * The callback receives the open MailboxObject (UIDVALIDITY, UIDNEXT, modseq),
 * which lives on the client rather than on the lock handle.
 */
export async function withReadOnlyMailbox<T>(
  client: ImapFlow,
  path: string,
  fn: (mailbox: MailboxObject) => Promise<T>,
): Promise<T> {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    if (!client.mailbox) {
      throw new Error(`Mailbox "${path}" could not be opened.`);
    }
    return await fn(client.mailbox);
  } finally {
    lock.release();
  }
}

/**
 * Turn IMAP failures into something worth showing a human, naming the
 * provider in use. Without one (e.g. before an account exists) it stays neutral.
 */
export function describeImapError(error: unknown, provider?: MailProvider): string {
  if (!(error instanceof Error)) return 'Unknown IMAP error.';

  const name = provider?.displayName ?? 'Your mail provider';
  const host = provider?.imap.host ?? 'the mail server';
  const passwordKind = provider ? `a ${provider.displayName} app password` : 'an app password';

  const message = error.message || '';
  const code = (error as { authenticationFailed?: boolean; code?: string }).code ?? '';

  if ((error as { authenticationFailed?: boolean }).authenticationFailed || /AUTHENTICATIONFAILED/i.test(message)) {
    return `${name} rejected the credentials. Check the email address, and make sure the password is ${passwordKind} rather than your account password.`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `Could not reach ${host}. Check your network connection.`;
  }
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(message)) {
    return `The connection to ${provider?.displayName ?? 'the mail server'} timed out.`;
  }
  if (/\[OVERQUOTA\]|too many|throttl/i.test(message)) {
    return `${name} is rate-limiting this connection. DayDesk will retry shortly.`;
  }
  return message || 'Unknown IMAP error.';
}
