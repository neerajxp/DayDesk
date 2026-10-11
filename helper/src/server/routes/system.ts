/**
 * System routes: health, status, and pairing.
 *
 * Mounted under /api/system.
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { MailSession } from '../../mail/session.js';
import { getProvider, listProviders } from '../../providers/index.js';
import { verifyCredentials } from '../../mail/client.js';
import { deleteAppPassword, saveAppPassword } from '../../secrets/keychain.js';
import * as accountsStore from '../../store/accounts.js';

const HELPER_VERSION = '0.1.0';

interface PairBody {
  email: string;
  appPassword: string;
  providerId?: string;
}

export interface SystemRouteDeps {
  readonly db: Database;
  readonly session: MailSession;
  /** Restart the session after pairing changes. */
  readonly restartSession: () => Promise<void>;
}

export async function registerSystemRoutes(
  app: FastifyInstance,
  deps: SystemRouteDeps,
): Promise<void> {
  /** Unauthenticated liveness probe so the panel can tell "not running" from "bad token". */
  app.get('/api/system/health', async () => ({
    ok: true,
    service: 'daydesk-helper',
    version: HELPER_VERSION,
  }));

  app.get('/api/system/status', async () => deps.session.getStatus());

  app.get('/api/system/providers', async () =>
    listProviders().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      authMethods: provider.authMethods,
      credentialHelpUrl: provider.credentialHelpUrl,
      maxMessagesPerFolder: provider.capabilities.maxMessagesPerFolder,
    })),
  );

  app.post<{ Body: PairBody }>(
    '/api/system/pair',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'appPassword'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320, format: 'email' },
            appPassword: { type: 'string', minLength: 1, maxLength: 256 },
            providerId: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, appPassword, providerId = 'yahoo' } = request.body;

      let provider;
      try {
        provider = getProvider(providerId);
      } catch (error) {
        return reply.code(400).send({
          error: 'unknown_provider',
          message: error instanceof Error ? error.message : 'Unknown provider.',
        });
      }

      // Fail fast on bad credentials rather than letting it surface later as a
      // mysterious sync error.
      const verified = await verifyCredentials({
        provider,
        email,
        appPassword: appPassword.replace(/\s+/g, ''), // Yahoo displays app passwords in spaced groups.
      });

      if (!verified.ok) {
        // Deliberately 422, not 401. The auth hook already uses 401 to mean
        // "your pairing token is bad", and the extension's client maps any 401
        // to that. Reusing it here reported a rejected Yahoo credential as a
        // token failure and threw away Yahoo's actual explanation.
        return reply.code(422).send({ error: 'credentials_rejected', message: verified.error });
      }

      saveAppPassword(email, appPassword.replace(/\s+/g, ''));
      accountsStore.upsertAccount(deps.db, email, provider.id);
      await deps.restartSession();

      return reply.code(201).send({ paired: true, email, provider: provider.id });
    },
  );

  app.delete('/api/system/pair', async (_request, reply) => {
    const account = accountsStore.getAccount(deps.db);
    if (!account) return reply.code(404).send({ error: 'not_paired', message: 'No account is paired.' });

    await deps.session.stop();
    deleteAppPassword(account.email);
    accountsStore.deleteAccount(deps.db, account.email);

    return { unpaired: true, email: account.email };
  });
}
