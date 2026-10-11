/**
 * Shared mail domain types.
 *
 * These are the shapes the HTTP API speaks, so the extension's typed client
 * mirrors them. Keep them provider-agnostic — nothing Yahoo-specific belongs here.
 */

/** Logical role of a mailbox, resolved from IMAP SPECIAL-USE rather than its name. */
export type FolderRole = 'inbox' | 'sent';

export interface MailAddress {
  readonly name: string;
  readonly address: string;
}

/** A message header row. Bodies are fetched separately and lazily. */
export interface MessageSummary {
  readonly id: number;
  readonly folderRole: FolderRole;
  readonly uid: number;
  readonly messageId: string | null;
  readonly subject: string;
  readonly from: MailAddress | null;
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly date: string | null;
  readonly internalDate: string;
  readonly size: number;
  /**
   * Read state as reported by Yahoo at last sync. DayDesk is read-only, so this
   * reflects what you did in Yahoo Mail elsewhere — DayDesk never changes it.
   */
  readonly isSeen: boolean;
  readonly isFlagged: boolean;
  readonly hasAttachments: boolean;
  readonly snippet: string;
}

export interface Attachment {
  readonly id: number;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
}

/** A fully hydrated message, including body. */
export interface MessageDetail extends MessageSummary {
  readonly bodyText: string | null;
  readonly bodyHtml: string | null;
  readonly attachments: readonly Attachment[];
}

export interface FolderState {
  readonly role: FolderRole;
  readonly path: string;
  readonly messageCount: number;
  readonly floorUid: number | null;
  readonly floorDate: string | null;
  readonly lastSyncAt: string | null;
}

export interface SyncStatus {
  readonly accountEmail: string | null;
  readonly isPaired: boolean;
  readonly isConnected: boolean;
  readonly isSyncing: boolean;
  readonly folders: readonly FolderState[];
  readonly lastError: string | null;
}

/** Events pushed over the WebSocket to an open side panel. */
export type ServerEvent =
  | { readonly type: 'sync:started'; readonly role: FolderRole }
  | { readonly type: 'sync:progress'; readonly role: FolderRole; readonly synced: number; readonly total: number }
  | { readonly type: 'sync:finished'; readonly role: FolderRole; readonly added: number; readonly removed: number }
  | { readonly type: 'sync:error'; readonly role: FolderRole; readonly message: string }
  | { readonly type: 'mail:new'; readonly role: FolderRole; readonly count: number }
  | { readonly type: 'status'; readonly status: SyncStatus };
