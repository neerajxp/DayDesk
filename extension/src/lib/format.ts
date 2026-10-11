/**
 * Presentation helpers. Pure functions, no React.
 */

import type { MailAddress } from './api/types.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact timestamp for the list column: time today, weekday this week,
 * day/month this year, otherwise year. Keeps the column narrow while staying
 * unambiguous.
 */
export function formatListDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const elapsed = now.getTime() - date.getTime();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (elapsed < 7 * DAY && elapsed >= 0) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Full timestamp for the detail header. */
export function formatFullDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Prefer the display name, fall back to the address, never render blank. */
export function formatAddress(address: MailAddress | null): string {
  if (!address) return 'Unknown sender';
  return address.name || address.address || 'Unknown sender';
}

export function formatAddressList(addresses: MailAddress[]): string {
  if (addresses.length === 0) return '—';
  return addresses.map((address) => address.name || address.address).join(', ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeSync(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'never synced';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'never synced';

  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return 'synced just now';
  if (elapsed < HOUR) return `synced ${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `synced ${Math.floor(elapsed / HOUR)}h ago`;
  return `synced ${Math.floor(elapsed / DAY)}d ago`;
}
