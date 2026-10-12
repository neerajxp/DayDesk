import { describe, expect, test } from 'vitest';
import { applyPreference, parsePreference, resolveTheme } from './theme.js';

describe('theme', () => {
  test('unknown or missing stored values fall back to auto', () => {
    expect(parsePreference('dark')).toBe('dark');
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference(null)).toBe('auto');
    expect(parsePreference('sepia')).toBe('auto');
  });

  test('auto follows the system; day and night ignore it', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  test('pins data-theme for day and night, and releases it for auto', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyPreference('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyPreference('auto', root);
    expect(root.dataset.theme).toBeUndefined();
  });
});
