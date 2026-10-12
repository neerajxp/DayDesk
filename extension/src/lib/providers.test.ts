import { describe, expect, test } from 'vitest';
import { guessProvider, providerById, PROVIDERS } from './providers.js';

describe('providers', () => {
  test('offers Yahoo first, then Gmail — matching the helper', () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(['yahoo', 'gmail']);
  });

  test('guesses the provider from the address', () => {
    expect(guessProvider('me@gmail.com')).toBe('gmail');
    expect(guessProvider('me@GoogleMail.com')).toBe('gmail');
    expect(guessProvider('me@yahoo.co.in')).toBe('yahoo');
    expect(guessProvider('me@ymail.com')).toBe('yahoo');
    expect(guessProvider('me@company.com')).toBeNull();
    expect(guessProvider('half-typed')).toBeNull();
  });

  test('looks providers up by id', () => {
    expect(providerById('gmail')?.name).toBe('Gmail');
    expect(providerById('outlook')).toBeNull();
  });
});
