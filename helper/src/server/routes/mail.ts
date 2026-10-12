/**
 * Mail routes: list, detail, search, sync.
 *
 * Mounted under /api/mail. Read-only by design — there is no endpoint here that
 * changes anything on the provider's side.
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { FolderRole, MessageDetail } from '../../types/mail.js';
import type { MailSession } from '../../mail/session.js';
import * as accountsStore from '../../store/accounts.js';
import * as foldersStore from '../../store/folders.js';
import * as messagesStore from '../../store/messages.js';
import { searchMessages } from '../../store/search.js';

const MAX_PAGE_SIZE = 200;

interface ListQuery {
  role?: FolderRole;
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

interface SearchQuery {
  q: string;
  role?: FolderRole;
  limit?: number;
  offset?: number;
}

export interface MailRouteDeps {
  readonly db: Database;
  readonly session: MailSession;
}

const paginationProperties = {
  limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: 50 },
  offset: { type: 'integer', minimum: 0, default: 0 },
} as const;

const roleProperty = { type: 'string', enum: ['inbox', 'sent'] } as const;

export async function registerMailRoutes(app: FastifyInstance, deps: MailRouteDeps): Promise<void> {
  /** Resolve the paired account or fail with a clear error. */
  function requireAccount(): { id: number } {
    const account = accountsStore.getAccount(deps.db);
    if (!account) {
      const error = new Error('DayDesk is not connected to an email account yet.') as Error & {
        statusCode?: number;
      };
      error.statusCode = 409;
      throw error;
    }
    return account;
  }

  app.get<{ Querystring: ListQuery }>(
    '/api/mail/messages',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            role: { ...roleProperty, default: 'inbox' },
            unreadOnly: { type: 'boolean', default: false },
            ...paginationProperties,
          },
        },
      },
    },
    async (request) => {
      const account = requireAccount();
      const role = request.query.role ?? 'inbox';
      const folder = foldersStore.getFolder(deps.db, account.id, role);

      if (!folder) return { messages: [], total: 0, role };

      const page = messagesStore.listMessages(deps.db, folder.id, role, {
        limit: request.query.limit ?? 50,
        offset: request.query.offset ?? 0,
        unreadOnly: request.query.unreadOnly ?? false,
      });

      return { ...page, role };
    },
  );

  /**
   * Message detail, fetching and caching the body on first open.
   *
   * A cache miss hits the mail server; a hit is purely local. The mailbox is opened
   * read-only, so this does not mark the message read on the server.
   */
  app.get<{ Params: { id: number } }>(
    '/api/mail/messages/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request, reply) => {
      requireAccount();

      const row = messagesStore.getMessageById(deps.db, request.params.id);
      if (!row) return reply.code(404).send({ error: 'not_found', message: 'No such message.' });

      const summary = messagesStore.rowToSummary(row, row.role);
      let body = messagesStore.getBody(deps.db, row.id);

      if (!body) {
        try {
          const fetched = await deps.session.loadBody(row.id, row.role, row.uid);
          if (fetched === null) {
            return reply.code(410).send({
              error: 'gone',
              message: 'This message is no longer on the server.',
            });
          }
          body = messagesStore.getBody(deps.db, row.id);
        } catch (error) {
          return reply.code(503).send({
            error: 'fetch_failed',
            message: error instanceof Error ? error.message : 'Could not fetch the message body.',
          });
        }
      }

      const detail: MessageDetail = {
        ...summary,
        bodyText: body?.body_text ?? null,
        bodyHtml: body?.body_html ?? null,
        attachments: messagesStore.listAttachments(deps.db, row.id),
      };

      return detail;
    },
  );

  app.get<{ Querystring: SearchQuery }>(
    '/api/mail/search',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          additionalProperties: false,
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 500 },
            role: roleProperty,
            ...paginationProperties,
          },
        },
      },
    },
    async (request) => {
      const account = requireAccount();
      const result = searchMessages(deps.db, account.id, request.query.q, {
        limit: request.query.limit ?? 50,
        offset: request.query.offset ?? 0,
        ...(request.query.role ? { role: request.query.role } : {}),
      });
      return { ...result, query: request.query.q };
    },
  );

  app.post<{ Body: { role?: FolderRole } }>(
    '/api/mail/sync',
    {
      schema: {
        // Nullable so `POST /api/mail/sync` with no body at all means "sync
        // everything" — the handler already treats an absent role that way.
        body: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: { role: roleProperty },
        },
      },
    },
    async (request, reply) => {
      requireAccount();
      try {
        await deps.session.requestSync(request.body?.role);
        return { ok: true, status: deps.session.getStatus() };
      } catch (error) {
        return reply.code(503).send({
          error: 'sync_failed',
          message: error instanceof Error ? error.message : 'Sync failed.',
        });
      }
    },
  );
}
