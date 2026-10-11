/**
 * DayDesk helper entrypoint.
 *
 * Starts the local server, restores the mail session if an account is already
 * paired, and wires up notifications.
 */

import { loadConfig } from './config/index.js';
import { ensureDirectories, PATHS } from './config/paths.js';
import { openDatabase, closeDatabase } from './store/db.js';
import { MailSession } from './mail/session.js';
import { createServer } from './server/app.js';
import { loadOrCreateToken } from './server/token.js';
import { startNotifier } from './notify/index.js';

async function main(): Promise<void> {
  ensureDirectories();

  const config = loadConfig();
  const token = loadOrCreateToken();
  const db = openDatabase();

  let session = new MailSession(db);

  const restartSession = async (): Promise<void> => {
    await session.stop();
    session = new MailSession(db);
    await session.start();
  };

  const server = await createServer({
    db,
    // Routes resolve the session lazily so a restart swaps the instance cleanly.
    session: new Proxy({} as MailSession, {
      get: (_target, property) => Reflect.get(session, property, session),
    }),
    token,
    port: config.port,
    restartSession,
  });

  const stopNotifier = startNotifier({ db, connectedPanels: server.connectedPanels });

  const address = await server.listen();
  await session.start();

  const status = session.getStatus();
  console.log(`\n  DayDesk helper listening on ${address}`);
  console.log(`  Pairing token: ${PATHS.token}`);
  console.log(
    status.isPaired
      ? `  Account: ${status.accountEmail} (backlog ${config.initialBacklog})\n`
      : `  Not paired yet — open the DayDesk side panel to connect an account.\n`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n  ${signal} received, shutting down.`);
    stopNotifier();
    await session.stop();
    await server.close();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('DayDesk helper failed to start:', error);
  process.exit(1);
});
