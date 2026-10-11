/**
 * Request authentication and host validation.
 *
 * Three independent controls, because a loopback HTTP server is reachable by
 * every page in your browser:
 *
 *   1. Bearer token — the actual access control.
 *   2. Host header validation — defends against DNS rebinding, where an
 *      attacker's domain resolves to 127.0.0.1 so their page's requests arrive
 *      here carrying their origin. Checking that Host is literally loopback
 *      rejects those, since the browser sends the attacker's hostname.
 *   3. Binding to 127.0.0.1 (see app.ts) — keeps the port off the network.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseBearer, tokensMatch } from './token.js';

/** Host header values that mean "this machine, on our port". */
function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;

  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    `::1:${port}`,
  ]);

  return allowed.has(host.toLowerCase());
}

export interface AuthOptions {
  readonly token: string;
  readonly port: number;
  /** Paths served without a token, e.g. the health probe. */
  readonly publicPaths: readonly string[];
}

export function createAuthHook(options: AuthOptions) {
  const publicPaths = new Set(options.publicPaths);

  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!isLoopbackHost(request.headers.host, options.port)) {
      await reply.code(421).send({
        error: 'misdirected_request',
        message: 'DayDesk only serves requests addressed to loopback.',
      });
      return;
    }

    // The health probe is unauthenticated so the panel can distinguish
    // "helper is not running" from "token is wrong". It reveals nothing.
    if (publicPaths.has(request.url.split('?')[0] ?? request.url)) return;

    const provided = parseBearer(request.headers.authorization);
    if (!provided || !tokensMatch(options.token, provided)) {
      await reply.code(401).send({
        error: 'unauthorized',
        message: 'A valid pairing token is required. Find it in ~/.daydesk/token.',
      });
    }
  };
}

export { isLoopbackHost };
