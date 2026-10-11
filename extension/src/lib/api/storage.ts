/**
 * Pairing token persistence.
 *
 * The token lives in chrome.storage.local, which is scoped to the extension and
 * not reachable by web pages. The Yahoo app password is never stored here — it
 * goes straight to the helper, which puts it in the macOS Keychain.
 */

const TOKEN_KEY = 'daydesk.pairingToken';

export async function readToken(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get(TOKEN_KEY);
    const token = stored[TOKEN_KEY];
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function writeToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token.trim() });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}
