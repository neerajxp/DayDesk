import { describe, expect, test } from 'vitest';
import { isFeatureEnabled } from './features.js';

const storage = (value: string | null) => ({ getItem: () => value });

describe('feature flags', () => {
  test('Gmail is off until released', () => {
    expect(isFeatureEnabled('gmail', storage(null))).toBe(false);
    expect(isFeatureEnabled('gmail', null)).toBe(false);
  });

  test('a local override turns it on (or off) for testing', () => {
    expect(isFeatureEnabled('gmail', storage('on'))).toBe(true);
    expect(isFeatureEnabled('gmail', storage('off'))).toBe(false);
    expect(isFeatureEnabled('gmail', storage('yes please'))).toBe(false);
  });
});
