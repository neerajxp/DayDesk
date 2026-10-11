import type { MailProvider } from './types.js';

/**
 * Yahoo Mail over standard IMAP with a third-party app password.
 *
 * Yahoo has no public REST mail API, so IMAP is the only read path. Standard
 * IMAP also only serves the most recent 10,000 messages per folder (changed
 * June 2022) — DayDesk's archive is what preserves anything beyond that, going
 * forward from first sync.
 */
export const YAHOO: MailProvider = {
  id: 'yahoo',
  displayName: 'Yahoo Mail',
  imap: {
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
  },
  authMethods: ['app-password'],
  capabilities: {
    idle: true,
    maxMessagesPerFolder: 10_000,
  },
  folderNameHints: {
    sent: ['Sent', 'Sent Items', 'Sent Messages'],
  },
  credentialHelpUrl: 'https://help.yahoo.com/kb/SLN15241.html',
};
