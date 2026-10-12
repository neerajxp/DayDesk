import type { MailProvider } from './types.js';
import { YAHOO } from './yahoo.js';
import { GMAIL } from './gmail.js';

/** Insertion order is the order the pairing screen offers them in. */
const REGISTRY: ReadonlyMap<string, MailProvider> = new Map([
  [YAHOO.id, YAHOO],
  [GMAIL.id, GMAIL],
]);

export function getProvider(id: string): MailProvider {
  const provider = REGISTRY.get(id);
  if (!provider) {
    throw new Error(`Unknown mail provider: ${id}. Known providers: ${listProviderIds().join(', ')}`);
  }
  return provider;
}

export function listProviderIds(): readonly string[] {
  return [...REGISTRY.keys()];
}

export function listProviders(): readonly MailProvider[] {
  return [...REGISTRY.values()];
}

export { YAHOO, GMAIL };
export type { MailProvider, AuthMethod, ProviderCapabilities } from './types.js';
