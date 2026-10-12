/**
 * Task routes: the Today board's data.
 *
 * Mounted under /api/tasks. These write only to DayDesk's local database —
 * ticking a task off never touches Yahoo.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { TaskKind, TaskStatus } from '../../types/tasks.js';
import { TASK_KINDS } from '../../types/tasks.js';
import * as accountsStore from '../../store/accounts.js';
import * as tasksStore from '../../store/tasks.js';
import { startOfDay } from '../../tasks/dates.js';

export interface TaskRouteDeps {
  readonly db: Database;
}

const MAX_TITLE_LENGTH = 200;
const DATE_KEY = '^\\d{4}-\\d{2}-\\d{2}$';

const dueDateProperty = { type: ['string', 'null'], pattern: DATE_KEY } as const;
const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'integer', minimum: 1 } },
} as const;

/** The JSON schema checks the shape; this rejects shape-valid nonsense like 2026-02-31. */
function isRealDate(key: string | null | undefined): boolean {
  if (key === null || key === undefined) return true;
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function badDate(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ error: 'bad_request', message: 'dueDate is not a real calendar date.' });
}

export async function registerTaskRoutes(app: FastifyInstance, deps: TaskRouteDeps): Promise<void> {
  function requireAccount(): { id: number } {
    const account = accountsStore.getAccount(deps.db);
    if (!account) {
      const error = new Error('DayDesk is not paired with a Yahoo account yet.') as Error & { statusCode?: number };
      error.statusCode = 409;
      throw error;
    }
    return account;
  }

  app.get('/api/tasks', async () => {
    const account = requireAccount();
    const tasks = tasksStore.listTasks(deps.db, account.id, {
      doneSince: startOfDay(new Date()).toISOString(),
    });
    return { tasks };
  });

  app.post<{ Body: { title: string; kind?: TaskKind; dueDate?: string | null; messageId?: number } }>(
    '/api/tasks',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
            kind: { type: 'string', enum: TASK_KINDS, default: 'todo' },
            dueDate: dueDateProperty,
            messageId: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const account = requireAccount();
      const { title, kind = 'todo', dueDate = null, messageId } = request.body;
      if (!isRealDate(dueDate)) return badDate(reply);

      const trimmed = title.trim();
      if (!trimmed) return reply.code(400).send({ error: 'bad_request', message: 'Title cannot be blank.' });

      if (messageId !== undefined) {
        const exists = deps.db.prepare('SELECT 1 FROM messages WHERE id = ?').get(messageId);
        if (!exists) return reply.code(404).send({ error: 'not_found', message: 'No such message.' });
      }

      const task = tasksStore.createManualTask(deps.db, account.id, { title: trimmed, kind, dueDate, messageId });
      return reply.code(201).send(task);
    },
  );

  app.patch<{ Params: { id: number }; Body: { status?: TaskStatus; dueDate?: string | null; title?: string } }>(
    '/api/tasks/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            status: { type: 'string', enum: ['open', 'done', 'dismissed'] },
            dueDate: dueDateProperty,
            title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const account = requireAccount();
      if (!isRealDate(request.body.dueDate)) return badDate(reply);

      const title = request.body.title?.trim();
      if (request.body.title !== undefined && !title) {
        return reply.code(400).send({ error: 'bad_request', message: 'Title cannot be blank.' });
      }

      const task = tasksStore.updateTask(deps.db, account.id, request.params.id, {
        ...(request.body.status ? { status: request.body.status } : {}),
        ...(request.body.dueDate !== undefined ? { dueDate: request.body.dueDate } : {}),
        ...(title ? { title } : {}),
      });
      if (!task) return reply.code(404).send({ error: 'not_found', message: 'No such task.' });
      return task;
    },
  );
}
