/**
 * API shapes, mirroring helper/src/types/mail.ts.
 *
 * Duplicated rather than shared because the extension builds for the browser
 * and the helper for Node; a shared package would be the right move once a
 * third consumer appears.
 */

export type FolderRole = 'inbox' | 'sent';

export interface MailAddress {
  name: string;
  address: string;
}

export interface MessageSummary {
  id: number;
  folderRole: FolderRole;
  uid: number;
  messageId: string | null;
  subject: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  date: string | null;
  internalDate: string;
  size: number;
  isSeen: boolean;
  isFlagged: boolean;
  hasAttachments: boolean;
  snippet: string;
}

export interface Attachment {
  id: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface MessageDetail extends MessageSummary {
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: Attachment[];
}

export interface FolderState {
  role: FolderRole;
  path: string;
  messageCount: number;
  floorUid: number | null;
  floorDate: string | null;
  lastSyncAt: string | null;
}

export interface SyncStatus {
  accountEmail: string | null;
  isPaired: boolean;
  isConnected: boolean;
  isSyncing: boolean;
  folders: FolderState[];
  lastError: string | null;
}

export interface MessagePage {
  messages: MessageSummary[];
  total: number;
  role: FolderRole;
}

export interface SearchResponse {
  hits: (MessageSummary & { rank: number })[];
  total: number;
  query: string;
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  authMethods: string[];
  credentialHelpUrl: string;
  maxMessagesPerFolder: number | null;
}

export type ServerEvent =
  | { type: 'sync:started'; role: FolderRole }
  | { type: 'sync:progress'; role: FolderRole; synced: number; total: number }
  | { type: 'sync:finished'; role: FolderRole; added: number; removed: number }
  | { type: 'sync:error'; role: FolderRole; message: string }
  | { type: 'mail:new'; role: FolderRole; count: number }
  | { type: 'status'; status: SyncStatus };

/** Why the panel cannot show mail right now. */
export type ConnectionProblem =
  | { kind: 'helper-down' }
  | { kind: 'needs-token' }
  | { kind: 'bad-token' }
  | { kind: 'not-paired' }
  | { kind: 'error'; message: string };
