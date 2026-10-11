/**
 * Provider contract.
 *
 * DayDesk talks generic IMAP, so a "provider" is just a connection preset plus
 * a declaration of which auth methods it supports. Adding Gmail, Outlook or a
 * self-hosted IMAP server later means adding a preset here — not touching the
 * sync engine.
 */

/** How credentials are obtained for a provider. */
export type AuthMethod = 'app-password' | 'oauth2';

export interface ProviderCapabilities {
  /** Server supports IMAP IDLE for push notification of new mail. */
  readonly idle: boolean;
  /**
   * Hard cap on how many of the newest messages the server will serve per
   * folder, if the provider imposes one. Yahoo caps standard IMAP at 10,000.
   * null means no known cap.
   */
  readonly maxMessagesPerFolder: number | null;
}

export interface MailProvider {
  readonly id: string;
  readonly displayName: string;
  readonly imap: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
  };
  readonly authMethods: readonly AuthMethod[];
  readonly capabilities: ProviderCapabilities;
  /**
   * Fallback mailbox names by role, used only when the server does not report
   * SPECIAL-USE attributes. Discovery prefers SPECIAL-USE; these are a safety net.
   */
  readonly folderNameHints: {
    readonly sent: readonly string[];
  };
  /** Where the user generates credentials, surfaced in the pairing UI. */
  readonly credentialHelpUrl: string;
}
