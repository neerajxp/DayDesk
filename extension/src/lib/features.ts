/**
 * Feature flags for work that is built but not yet released.
 *
 * A flag is off for everyone by default. To try one locally, open the side
 * panel's DevTools console (right-click the panel → Inspect) and run:
 *
 *   localStorage.setItem('daydesk.feature.gmail', 'on')
 *
 * then close and reopen the panel. Remove the key to turn it off again.
 * Release a feature by flipping its default to true.
 */

export type FeatureId = 'gmail';

const DEFAULTS: Record<FeatureId, boolean> = {
  // Gmail connects end-to-end but is awaiting real-account testing.
  gmail: false,
};

export function isFeatureEnabled(feature: FeatureId, storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  const override = storage?.getItem(`daydesk.feature.${feature}`);
  if (override === 'on') return true;
  if (override === 'off') return false;
  return DEFAULTS[feature];
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
