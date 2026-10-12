import type { MailProvider } from './types.js';

/**
 * Gmail over standard IMAP with a Google app password.
 *
 * App passwords need 2-Step Verification on the Google account, and work or
 * school (Workspace) accounts may have them disabled by an admin. Gmail serves
 * INBOX and advertises SPECIAL-USE, so the Sent folder ("[Gmail]/Sent Mail",
 * or "[Google Mail]/…" in some regions) is normally found without the hints.
 * Unlike Yahoo, Gmail imposes no per-folder cap on what IMAP serves.
 */
export const GMAIL: MailProvider = {
  id: 'gmail',
  displayName: 'Gmail',
  imap: {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
  },
  authMethods: ['app-password'],
  capabilities: {
    idle: true,
    maxMessagesPerFolder: null,
  },
  folderNameHints: {
    sent: ['[Gmail]/Sent Mail', '[Google Mail]/Sent Mail', 'Sent Mail', 'Sent'],
  },
  credentialHelpUrl: 'https://myaccount.google.com/apppasswords',
};
