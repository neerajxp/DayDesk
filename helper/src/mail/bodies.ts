/**
 * Lazy body fetching.
 *
 * Bodies are the bulk of a mailbox, and most messages are never opened, so only
 * headers are synced up front. The first time a message is opened its full
 * source is fetched, parsed, and cached permanently — subsequent opens are local.
 *
 * The mailbox is open read-only, so this fetch does not mark the message \Seen
 * on Yahoo's side.
 */

import { simpleParser } from 'mailparser';
import type { Database } from 'better-sqlite3';
import type { ImapFlow } from 'imapflow';
import * as messagesStore from '../store/messages.js';
import { makeSnippet } from './parse.js';
import { withReadOnlyMailbox } from './client.js';

export interface FetchBodyContext {
  readonly db: Database;
  readonly client: ImapFlow;
}

export interface ParsedBody {
  readonly text: string | null;
  readonly html: string | null;
  readonly attachments: readonly {
    filename: string;
    contentType: string;
    size: number;
    contentId: string | null;
  }[];
}

/**
 * Fetch and cache one message body.
 *
 * Returns null when the message is no longer on the server — it may have been
 * deleted between the last sync and this open.
 */
export async function fetchAndStoreBody(
  ctx: FetchBodyContext,
  folderPath: string,
  messageRowId: number,
  uid: number,
): Promise<ParsedBody | null> {
  const raw = await withReadOnlyMailbox(ctx.client, folderPath, async () => {
    const message = await ctx.client.fetchOne(String(uid), { source: true }, { uid: true });
    if (!message || typeof message === 'boolean' || !message.source) return null;
    return message.source;
  });

  if (!raw) return null;

  const parsed = await simpleParser(raw);

  const body: ParsedBody = {
    text: parsed.text ?? null,
    html: typeof parsed.html === 'string' ? parsed.html : null,
    attachments: (parsed.attachments ?? [])
      // Inline parts (embedded images) are not user-facing attachments.
      .filter((attachment) => attachment.contentDisposition !== 'inline')
      .map((attachment) => ({
        filename: attachment.filename ?? 'untitled',
        contentType: attachment.contentType ?? 'application/octet-stream',
        size: attachment.size ?? 0,
        contentId: attachment.contentId ?? null,
      })),
  };

  messagesStore.saveBody(ctx.db, messageRowId, { text: body.text, html: body.html });
  messagesStore.saveAttachments(ctx.db, messageRowId, body.attachments);

  // Upgrade the list snippet from subject-derived to real body text.
  const snippet = makeSnippet(body.text);
  if (snippet) {
    ctx.db.prepare('UPDATE messages SET snippet = ? WHERE id = ?').run(snippet, messageRowId);
  }

  return body;
}
