import { describe, expect, test } from 'vitest';
import { applyStyle, parseStyle, STYLES } from './style.js';

describe('style', () => {
  test('keeps known styles and falls back to Desk for anything else', () => {
    expect(parseStyle('terminal')).toBe('terminal');
    expect(parseStyle('cards')).toBe('cards');
    expect(parseStyle(null)).toBe('desk');
    expect(parseStyle('vaporwave')).toBe('desk');
  });

  test('Desk is the absence of the attribute, others set it', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyStyle('bento', root);
    expect(root.dataset.style).toBe('bento');
    applyStyle('desk', root);
    expect(root.dataset.style).toBeUndefined();
  });

  test('every style has a unique id and a preview swatch', () => {
    expect(new Set(STYLES.map((style) => style.id)).size).toBe(STYLES.length);
    for (const style of STYLES) expect(style.swatch.paper).toMatch(/^#/);
  });
});
