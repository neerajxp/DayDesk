/**
 * Notification policy: notify about new tasks and new mail only when nobody is
 * looking.
 *
 * If a side panel is connected over the WebSocket, it will render the new mail
 * itself and a notification would be noise.
 */

import type { Database } from 'better-sqlite3';
import { loadConfig } from '../config/index.js';
import { bus } from '../events.js';
import { notify } from './macos.js';

export interface NotifierDeps {
  readonly db: Database;
  /** How many side panels are currently connected. */
  readonly connectedPanels: () => number;
}

export function startNotifier(deps: NotifierDeps): () => void {
  return bus.subscribe((event) => {
    if (event.type !== 'mail:new' && event.type !== 'tasks:changed') return;
    if (!loadConfig().osNotifications) return;
    if (deps.connectedPanels() > 0) return;

    if (event.type === 'tasks:changed') {
      // A trail update (follow-up, mention) refreshes the board but is not news.
      if (event.added === 0) return;
      // A task is more useful than "1 new message" — say what needs doing.
      const others = event.added - 1;
      void notify({
        title: 'DayDesk — new to-do',
        body: `${event.firstTitle ?? 'Something needs doing'}${others > 0 ? ` (+${others} more)` : ''}`,
      });
      return;
    }

    const plural = event.count === 1 ? 'message' : 'messages';
    void notify({
      title: 'DayDesk',
      body: `${event.count} new ${plural} in your inbox.`,
    });
  });
}
