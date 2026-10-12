/**
 * Chat intake: messages from watched WhatsApp chats, posted by the extension.
 *
 * The extension's WhatsApp tab filters to watched chats before sending, so
 * this route never sees the rest of your WhatsApp. It stores the text, runs
 * the chat rules, and announces any new tasks.
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { ChatSource } from '../../types/tasks.js';
import { bus } from '../../events.js';
import * as accountsStore from '../../store/accounts.js';
import * as chatStore from '../../store/chat.js';
import { CHAT_RULES_VERSION, extractChatTask } from '../../tasks/chat.js';
import { rescanChatMessages } from '../../tasks/chatScan.js';
import { ingest } from '../../tasks/ingest.js';

export interface ChatRouteDeps {
  readonly db: Database;
}

const MAX_BATCH = 50;
/** WhatsApp Web renders history on load; anything older than this is not news. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Tolerate clock skew between the page and this machine, but not nonsense. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
/** Invisible direction marks WhatsApp wraps text in (LRM, RLM, LRE…PDF, isolates). */
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const clean = (value: string): string => value.replace(BIDI_CONTROLS, '').trim();

interface IncomingMessage {
  chat: string;
  sender?: string;
  text: string;
  isFromMe?: boolean;
  sentAt: string;
}

export async function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps): Promise<void> {
  app.post<{ Body: { source: ChatSource; messages: IncomingMessage[] } }>(
    '/api/chat/messages',
    {
      schema: {
        body: {
          type: 'object',
          required: ['source', 'messages'],
          additionalProperties: false,
          properties: {
            source: { type: 'string', enum: ['whatsapp'] },
            messages: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_BATCH,
              items: {
                type: 'object',
                required: ['chat', 'text', 'sentAt'],
                additionalProperties: false,
                properties: {
                  chat: { type: 'string', minLength: 1, maxLength: 200 },
                  sender: { type: 'string', maxLength: 200, default: '' },
                  text: { type: 'string', minLength: 1, maxLength: 4000 },
                  isFromMe: { type: 'boolean', default: false },
                  sentAt: { type: 'string', minLength: 1, maxLength: 40 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const account = accountsStore.getAccount(deps.db);
      if (!account) {
        return reply.code(409).send({
          error: 'not_paired',
          message: 'Connect DayDesk to your email account before connecting WhatsApp.',
        });
      }

      const now = Date.now();
      let accepted = 0;
      let skipped = 0;
      let added = 0;
      let linked = 0;
      let firstTitle: string | null = null;

      for (const incoming of request.body.messages) {
        const parsed = new Date(incoming.sentAt);
        const sentAtMs = Number.isNaN(parsed.getTime()) ? now : Math.min(parsed.getTime(), now + MAX_FUTURE_MS);
        if (now - sentAtMs > MAX_AGE_MS) {
          skipped += 1;
          continue;
        }

        const message = {
          source: request.body.source,
          chatName: clean(incoming.chat),
          sender: clean(incoming.sender ?? ''),
          text: clean(incoming.text),
          isFromMe: incoming.isFromMe ?? false,
          sentAt: new Date(sentAtMs),
        };
        if (!message.chatName || !message.text) {
          skipped += 1;
          continue;
        }

        const result = deps.db.transaction(() => {
          const row = chatStore.insertChatMessage(deps.db, message);
          if (!row.isNew) return null;
          const candidate = extractChatTask(message);
          const ingested = ingest(deps.db, account.id, { chatMessageId: row.id }, {
            candidates: candidate ? [candidate] : [],
            text: message.text,
            now: new Date(now),
          });
          chatStore.markChatChecked(deps.db, row.id, CHAT_RULES_VERSION);
          return ingested;
        })();

        if (result === null) {
          skipped += 1;
          continue;
        }
        accepted += 1;
        added += result.added.length;
        linked += result.linked;
        firstTitle ??= result.added[0]?.title ?? null;
      }

      // Anything stored earlier but read by older rules gets a second look too,
      // so a resend from the WhatsApp tab ("Sync now") is never a dead end.
      const rescan = rescanChatMessages(deps.db, account.id, new Date(now));
      added += rescan.added;
      linked += rescan.linked;
      firstTitle ??= rescan.firstTitle;

      // A new link changes a task's trail, so the board refreshes for it too.
      if (added > 0 || linked > 0) bus.publish({ type: 'tasks:changed', added, firstTitle });
      return { accepted, skipped, added, linked };
    },
  );
}
