/**
 * HTTP + WebSocket server.
 *
 * Binds to loopback only. Every route except the health probe requires the
 * pairing token. CORS is configured as defence in depth rather than as the
 * access control — the token is the control.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { Database } from 'better-sqlite3';
import type { MailSession } from '../mail/session.js';
import type { ServerEvent } from '../types/mail.js';
import { bus } from '../events.js';
import { createAuthHook } from './auth.js';
import { tokensMatch } from './token.js';
import { registerMailRoutes } from './routes/mail.js';
import { registerSystemRoutes } from './routes/system.js';

/**
 * Paths the onRequest auth hook does not demand an Authorization header on.
 *
 * Neither is unauthenticated in effect:
 *  - the health probe reveals nothing beyond "the helper is up", and exists so
 *    the panel can tell that apart from "your token is wrong";
 *  - /api/events is a WebSocket upgrade, and browsers cannot set headers on a
 *    WS handshake. Its token arrives as a query parameter and is verified in
 *    the handler below, which closes with 1008 on a mismatch.
 *
 * The Host check in the hook still applies to both.
 */
const PUBLIC_PATHS = ['/api/system/health', '/api/events'] as const;

export interface ServerOptions {
  readonly db: Database;
  readonly session: MailSession;
  readonly token: string;
  readonly port: number;
  readonly restartSession: () => Promise<void>;
  /** Set false in tests to keep request logs out of the output. */
  readonly logging?: boolean;
}

export interface DayDeskServer {
  readonly app: FastifyInstance;
  readonly connectedPanels: () => number;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export async function createServer(options: ServerOptions): Promise<DayDeskServer> {
  const app = Fastify({
    logger:
      options.logging === false
        ? false
        : {
            level: process.env.DAYDESK_LOG_LEVEL ?? 'info',
            // The pairing token must never reach the logs.
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    // The extension's origin is chrome-extension://<id>, and the id is not
    // known until the unpacked extension is loaded. Set DAYDESK_EXTENSION_ORIGIN
    // to pin it once you know it.
    origin: process.env.DAYDESK_EXTENSION_ORIGIN ?? /^chrome-extension:\/\/[a-p]{32}$/,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  });

  await app.register(websocket);

  app.addHook('onRequest', createAuthHook({
    token: options.token,
    port: options.port,
    publicPaths: PUBLIC_PATHS,
  }));

  await registerSystemRoutes(app, {
    db: options.db,
    session: options.session,
    restartSession: options.restartSession,
  });
  await registerMailRoutes(app, { db: options.db, session: options.session });

  // ── Live event stream ────────────────────────────────────────────────────
  const sockets = new Set<import('ws').WebSocket>();

  app.register(async (instance) => {
    instance.get<{ Querystring: { token?: string } }>(
      '/api/events',
      { websocket: true },
      (connection, request) => {
        // Browsers cannot set an Authorization header on a WebSocket handshake,
        // so the token arrives as a query parameter. Acceptable over loopback;
        // still compared in constant time.
        const provided = request.query.token ?? '';
        if (!provided || !tokensMatch(options.token, provided)) {
          connection.close(1008, 'unauthorized');
          return;
        }

        sockets.add(connection);
        connection.send(JSON.stringify({ type: 'status', status: options.session.getStatus() }));

        connection.on('close', () => sockets.delete(connection));
        connection.on('error', () => sockets.delete(connection));
      },
    );
  });

  const unsubscribe = bus.subscribe((event: ServerEvent) => {
    const payload = JSON.stringify(event);
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        sockets.delete(socket);
      }
    }
  });

  return {
    app,
    connectedPanels: () => sockets.size,
    async listen() {
      // Loopback only. Binding 0.0.0.0 would expose your mail to the network.
      return app.listen({ port: options.port, host: '127.0.0.1' });
    },
    async close() {
      unsubscribe();
      for (const socket of sockets) socket.close(1001, 'server shutting down');
      sockets.clear();
      await app.close();
    },
  };
}
