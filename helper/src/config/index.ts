/**
 * Runtime configuration, read from ~/.daydesk/config.json with env overrides.
 *
 * `initialBacklog` is deliberately a config value rather than a constant: the
 * first sync anchors a floor at the Nth-newest message and never backfills
 * below it, so raising this later widens the archive on the next sync without
 * any schema change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { PATHS } from './paths.js';

export interface DayDeskConfig {
  /** Loopback port for the helper's HTTP + WS server. */
  readonly port: number;
  /** How many of the newest messages to pull on a folder's first sync. */
  readonly initialBacklog: number;
  /** How many messages to request per IMAP FETCH batch. */
  readonly fetchBatchSize: number;
  /** Minutes between full reconciliation passes (flag + deletion diffing). */
  readonly reconcileIntervalMinutes: number;
  /** Raise an OS notification when new mail arrives and no panel is connected. */
  readonly osNotifications: boolean;
}

const DEFAULTS: DayDeskConfig = {
  port: 4287,
  initialBacklog: 1000,
  fetchBatchSize: 100,
  reconcileIntervalMinutes: 15,
  osNotifications: true,
};

function coerceNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

let cached: DayDeskConfig | null = null;

export function loadConfig(): DayDeskConfig {
  if (cached) return cached;

  let fromDisk: Partial<DayDeskConfig> = {};
  try {
    fromDisk = JSON.parse(readFileSync(PATHS.config, 'utf8')) as Partial<DayDeskConfig>;
  } catch {
    // No config file yet — defaults are correct for a first run.
  }

  cached = {
    port: coerceNumber(process.env.DAYDESK_PORT ?? fromDisk.port, DEFAULTS.port, 1024, 65535),
    initialBacklog: coerceNumber(
      process.env.DAYDESK_BACKLOG ?? fromDisk.initialBacklog,
      DEFAULTS.initialBacklog,
      1,
      10_000,
    ),
    fetchBatchSize: coerceNumber(fromDisk.fetchBatchSize, DEFAULTS.fetchBatchSize, 10, 500),
    reconcileIntervalMinutes: coerceNumber(
      fromDisk.reconcileIntervalMinutes,
      DEFAULTS.reconcileIntervalMinutes,
      1,
      1440,
    ),
    osNotifications: fromDisk.osNotifications ?? DEFAULTS.osNotifications,
  };

  return cached;
}

/** Persist config, creating the file on first write. Returns the saved shape. */
export function saveConfig(patch: Partial<DayDeskConfig>): DayDeskConfig {
  const next = { ...loadConfig(), ...patch };
  writeFileSync(PATHS.config, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  cached = next;
  return next;
}

/** Test seam — forces the next loadConfig() to re-read from disk. */
export function resetConfigCache(): void {
  cached = null;
}

export { DEFAULTS as CONFIG_DEFAULTS };
