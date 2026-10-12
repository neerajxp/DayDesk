import { readToken } from '../lib/api/storage.js';
import { HELPER_ORIGIN } from '../lib/api/client.js';
import { isDeliverRequest, type DeliverRequest, type DeliverResponse } from '../lib/whatsapp/messaging.js';

/**
 * Background service worker.
 *
 * Deliberately minimal. MV3 tears service workers down after roughly 30s idle,
 * so nothing stateful belongs here — no WebSocket, no polling loop. The side
 * panel is a real page and owns the live connection; the helper daemon owns
 * notifications.
 *
 * The side panel is per tab. The manifest declares no global panel (see
 * wxt.config.ts), so DayDesk exists only in tabs where you clicked its icon:
 * switch away and it hides, switch back and it is there again, close the tab
 * and it is gone. Opening it in another tab gives that tab its own panel.
 */

const PANEL_PATH = 'sidepanel.html';

export default defineBackground(() => {
  // The icon click is handled below rather than by Chrome, so the panel can be
  // scoped to the clicked tab.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error: unknown) => console.error('DayDesk: could not set panel behavior', error));

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    // Both calls are made synchronously, without awaiting: sidePanel.open()
    // must run inside the click's user gesture, which an await would lose.
    // Chrome applies setOptions before open, as calls are queued in order.
    void chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true });
    chrome.sidePanel
      .open({ tabId: tab.id })
      .catch((error: unknown) => console.error('DayDesk: could not open the panel', error));
  });

  // Relay for the WhatsApp tab. Only our own content script can reach this:
  // sender.id must be this extension, and the tab must be WhatsApp Web.
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !isDeliverRequest(message)) return false;
    if (!sender.url?.startsWith('https://web.whatsapp.com/')) return false;
    void deliver(message).then(sendResponse);
    return true; // keep the channel open for the async response
  });

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // First run needs the pairing token from ~/.daydesk/token, which is
      // easier to explain on a full page than in the narrow panel.
      void chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });
    }
  });
});

/** Forward watched-chat messages to the helper with the pairing token. */
async function deliver(request: DeliverRequest): Promise<DeliverResponse> {
  const token = await readToken();
  if (!token) return { ok: false, error: 'DayDesk is not paired yet — open the side panel.' };

  try {
    const response = await fetch(`${HELPER_ORIGIN}/api/chat/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'whatsapp', messages: request.messages }),
    });
    if (!response.ok) {
      const detail = await response
        .json()
        .then((body: { message?: string }) => body.message)
        .catch(() => undefined);
      return { ok: false, error: detail ?? `The helper answered ${response.status}.` };
    }
    const body = (await response.json()) as { accepted: number; added: number; linked: number };
    return { ok: true, accepted: body.accepted, added: body.added, linked: body.linked };
  } catch {
    return { ok: false, error: 'The DayDesk helper is not running.' };
  }
}
