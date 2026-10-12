/**
 * Visual styles — whole looks for the panel, layered on top of Day / Night.
 *
 * A style is a set of tokens (colour, type, radius) plus a few layout rules,
 * all keyed off data-style on <html> (see styles/themes/*.css). Each style
 * defines both a day and a night palette, so the Day / Night switch keeps
 * working whichever style is chosen. "desk" is the original look and needs no
 * attribute.
 *
 * Stored in localStorage for the same reason as the theme: it must apply
 * before the first paint.
 */

import { useSyncExternalStore } from 'react';

export type StyleId = 'desk' | 'ledger' | 'notebook' | 'terminal' | 'bento' | 'cards';

export interface StyleInfo {
  readonly id: StyleId;
  readonly name: string;
  readonly description: string;
  /** Day-palette colours and display font for the menu's preview chip. */
  readonly swatch: { readonly paper: string; readonly ink: string; readonly accent: string; readonly font: string };
}

export const STYLES: readonly StyleInfo[] = [
  {
    id: 'desk',
    name: 'Desk',
    description: 'Warm paper, ochre, serif',
    swatch: { paper: '#f8f4ec', ink: '#2a2420', accent: '#b9792a', font: "'Iowan Old Style', Georgia, serif" },
  },
  {
    id: 'ledger',
    name: 'Ledger',
    description: 'Swiss rules, black ink, one red',
    swatch: { paper: '#ffffff', ink: '#111111', accent: '#e2231a', font: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  },
  {
    id: 'notebook',
    name: 'Notebook',
    description: 'Lined paper, blue ink, red margin',
    swatch: { paper: '#fbf7e9', ink: '#1f3a8a', accent: '#d9534f', font: "Noteworthy, 'Bradley Hand', 'Segoe Print', cursive" },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Monospace, [ ] boxes, green glow',
    swatch: { paper: '#0f1410', ink: '#7ee787', accent: '#e3b341', font: "'SF Mono', Menlo, monospace" },
  },
  {
    id: 'bento',
    name: 'Bento',
    description: 'Rounded cards, soft pastels',
    swatch: { paper: '#f3f1fb', ink: '#262340', accent: '#7c6cf0', font: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" },
  },
  {
    id: 'cards',
    name: 'Cards',
    description: 'Material cards, actions on each',
    swatch: { paper: '#f3f4f9', ink: '#1b1b1f', accent: '#3f51b5', font: "Roboto, 'Helvetica Neue', system-ui, sans-serif" },
  },
];

const STORAGE_KEY = 'daydesk.style';
const DEFAULT_STYLE: StyleId = 'desk';

export function parseStyle(value: unknown): StyleId {
  return STYLES.some((style) => style.id === value) ? (value as StyleId) : DEFAULT_STYLE;
}

export function readStyle(): StyleId {
  try {
    return parseStyle(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_STYLE;
  }
}

/** Set data-style on <html>; the default style is the absence of the attribute. */
export function applyStyle(style: StyleId, root: HTMLElement = document.documentElement): void {
  if (style === DEFAULT_STYLE) delete root.dataset.style;
  else root.dataset.style = style;
}

// ── Shared store ────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let current: StyleId = typeof localStorage === 'undefined' ? DEFAULT_STYLE : readStyle();

export function setStyle(next: StyleId): void {
  current = next;
  try {
    if (next === DEFAULT_STYLE) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
  applyStyle(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStyle(): StyleId {
  return useSyncExternalStore(subscribe, () => current);
}
