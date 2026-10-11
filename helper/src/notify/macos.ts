/**
 * macOS notifications, raised by the helper rather than by Chrome.
 *
 * The helper is a persistent process, so it can notify even when the side panel
 * is closed or Chrome is quit. An MV3 service worker cannot — it is torn down
 * after ~30s idle.
 *
 * Security note: notification text comes from mail subjects and sender names,
 * which are attacker-controlled. The strings are therefore passed to osascript
 * as `argv` and referenced via `item n of argv`, never interpolated into the
 * script source. Interpolating would let a crafted subject line containing a
 * quote close the string and run arbitrary AppleScript.
 */

import { execFile } from 'node:child_process';
import { platform } from 'node:os';

const NOTIFY_TIMEOUT_MS = 5_000;

export interface Notification {
  readonly title: string;
  readonly subtitle?: string;
  readonly body: string;
}

export function isSupported(): boolean {
  return platform() === 'darwin';
}

/**
 * Display a notification. Never throws — a failed notification must not take
 * down a sync pass.
 */
export async function notify(notification: Notification): Promise<boolean> {
  if (!isSupported()) return false;

  const script = notification.subtitle
    ? 'on run argv\ndisplay notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)\nend run'
    : 'on run argv\ndisplay notification (item 1 of argv) with title (item 2 of argv)\nend run';

  const args = ['-e', script, notification.body, notification.title];
  if (notification.subtitle) args.push(notification.subtitle);

  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', args, { timeout: NOTIFY_TIMEOUT_MS }, (error) => {
      resolve(!error);
    });
  });
}
