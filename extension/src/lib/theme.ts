/**
 * Day / Night theme.
 *
 * The colour tokens already define both palettes; this module only decides
 * which one applies. "auto" follows the Mac's appearance; "light" and "dark"
 * pin it via data-theme on <html>, which tokens.css honours.
 *
 * The preference is kept in localStorage, not chrome.storage: it must be
 * readable synchronously before the first paint, or the panel would flash the
 * wrong theme every time it opens. It is a per-device display preference, so
 * localStorage's scope is exactly right.
 */

import { useSyncExternalStore } from 'react';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'daydesk.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function parsePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): Theme {
  if (preference === 'auto') return systemIsDark ? 'dark' : 'light';
  return preference;
}

export function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

/** Pin or release the theme on <html>. Safe to call before React renders. */
export function applyPreference(preference: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (preference === 'auto') delete root.dataset.theme;
  else root.dataset.theme = preference;
}

// ── A tiny shared store, so every component sees one preference ─────────────

const listeners = new Set<() => void>();
let current: ThemePreference = typeof localStorage === 'undefined' ? 'auto' : readPreference();

export function setPreference(next: ThemePreference): void {
  current = next;
  try {
    if (next === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
  applyPreference(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', listener);
  };
}

/** Current preference and the theme it resolves to right now. */
export function useTheme(): { preference: ThemePreference; theme: Theme } {
  const preference = useSyncExternalStore(subscribe, () => current);
  const systemIsDark = useSyncExternalStore(subscribe, () => window.matchMedia(DARK_QUERY).matches);
  return { preference, theme: resolveTheme(preference, systemIsDark) };
}
