import type { MailProvider } from './types.js';
import { YAHOO } from './yahoo.js';

const REGISTRY: ReadonlyMap<string, MailProvider> = new Map([[YAHOO.id, YAHOO]]);

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

export { YAHOO };
export type { MailProvider, AuthMethod, ProviderCapabilities } from './types.js';
