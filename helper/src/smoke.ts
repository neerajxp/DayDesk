/**
 * Phase 0 smoke test.
 *
 * Connects to Yahoo with your app password and reports what IMAP will actually
 * serve: which mailboxes exist, how the inbox and sent folders resolve, how
 * many messages are reachable, and where the 1,000-message floor would land.
 *
 * Run this before trusting the helper with anything:
 *   DAYDESK_EMAIL=you@yahoo.com DAYDESK_APP_PASSWORD="xxxx xxxx xxxx xxxx" \
 *     npm run smoke --workspace=helper
 *
 * The password is read from the environment and never written anywhere.
 *
 * Lives in src/ rather than scripts/ so it compiles with the rest of the helper
 * and runs on plain node. It deliberately avoids tsx: npm drops esbuild's
 * platform binary often enough that a first-run diagnostic should not need it.
 */

import { YAHOO } from './providers/yahoo.js';
import { createClient, describeImapError } from './mail/client.js';
import { resolveFolders, type RawMailbox } from './mail/discover.js';
import { selectInitialWindow } from './mail/anchor.js';
import { loadConfig } from './config/index.js';

async function main(): Promise<void> {
  const email = process.env.DAYDESK_EMAIL;
  const appPassword = process.env.DAYDESK_APP_PASSWORD?.replace(/\s+/g, '');

  if (!email || !appPassword) {
    console.error(
      '\n  Set both variables, then re-run:\n' +
        '    DAYDESK_EMAIL=you@yahoo.com DAYDESK_APP_PASSWORD="xxxx xxxx xxxx xxxx" \\\n' +
        '      npm run smoke --workspace=helper\n',
    );
    process.exit(1);
  }

  const backlog = loadConfig().initialBacklog;
  console.log(`\n  Connecting to ${YAHOO.imap.host}:${YAHOO.imap.port} as ${email}…`);

  const client = createClient({ provider: YAHOO, email, appPassword });

  try {
    await client.connect();
    console.log('  ✓ Authenticated.\n');

    const mailboxes = (await client.list()) as unknown as RawMailbox[];

    // Count every mailbox, not just the two DayDesk syncs. STATUS is cheaper
    // than opening each one, and this is what tells you where your mail
    // actually lives — v1 only reads Inbox and Sent, so anything filed
    // elsewhere would otherwise be invisible with no explanation.
    console.log('  Mailboxes reported by the server:\n');
    console.log('    messages  unseen  mailbox');
    let totalAcrossAllFolders = 0;

    for (const mailbox of mailboxes) {
      let messages = 0;
      let unseen = 0;
      try {
        const status = await client.status(mailbox.path, { messages: true, unseen: true });
        messages = status.messages ?? 0;
        unseen = status.unseen ?? 0;
      } catch {
        // Some mailboxes are \Noselect; a failure here is not interesting.
      }
      totalAcrossAllFolders += messages;

      const special = mailbox.specialUse ? ` ${mailbox.specialUse}` : '';
      console.log(
        `    ${String(messages).padStart(8)}  ${String(unseen).padStart(6)}  ${mailbox.path}${special}`,
      );
    }
    console.log(`\n    ${String(totalAcrossAllFolders).padStart(8)}  total across all mailboxes\n`);

    const folders = resolveFolders(mailboxes, YAHOO);
    console.log(`\n  Resolved roles:\n    inbox → ${folders.inbox}\n    sent  → ${folders.sent}\n`);

    for (const [role, path] of Object.entries(folders)) {
      // Read-only: EXAMINE, so nothing is marked \Seen by this probe.
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const mailbox = client.mailbox;
        if (!mailbox) continue;

        const uids = (await client.search({ all: true }, { uid: true })) || [];
        const uidList = Array.isArray(uids) ? uids.map(Number) : [];
        const window = selectInitialWindow(uidList, backlog);

        console.log(`  ${role.toUpperCase()} (${path})`);
        console.log(`    reachable over IMAP : ${uidList.length}`);
        console.log(`    uidvalidity         : ${mailbox.uidValidity}`);
        console.log(`    uidnext             : ${mailbox.uidNext}`);
        console.log(`    condstore/modseq    : ${mailbox.highestModseq ?? 'not supported'}`);

        if (window) {
          console.log(`    first sync would take: ${window.uids.length} (floor uid ${window.floorUid})`);
          if (window.truncated) {
            console.log(
              `    note: ${window.availableCount - window.uids.length} older reachable messages ` +
                `fall below the ${backlog}-message floor and will not be archived.`,
            );
          }
        } else {
          console.log('    first sync would take: nothing (folder is empty)');
        }

        const cap = YAHOO.capabilities.maxMessagesPerFolder;
        if (cap !== null && uidList.length >= cap) {
          console.log(
            `    note: at or above Yahoo's ${cap}-per-folder IMAP cap — older mail exists in your\n` +
              `          account but is not reachable over IMAP at all.`,
          );
        }
        console.log('');
      } finally {
        lock.release();
      }
    }

    await client.logout();
    console.log('  Done. Nothing was written to your mailbox or to disk.\n');
  } catch (error) {
    console.error(`\n  ✗ ${describeImapError(error)}\n`);
    if (client.usable) client.close();
    process.exit(1);
  }
}

void main();
