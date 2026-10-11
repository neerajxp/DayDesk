/**
 * Notification policy: notify about new mail only when nobody is looking.
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
    if (event.type !== 'mail:new') return;
    if (!loadConfig().osNotifications) return;
    if (deps.connectedPanels() > 0) return;

    const plural = event.count === 1 ? 'message' : 'messages';
    void notify({
      title: 'DayDesk',
      body: `${event.count} new ${plural} in your inbox.`,
    });
  });
}
