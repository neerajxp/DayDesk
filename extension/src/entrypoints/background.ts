/**
 * Background service worker.
 *
 * Deliberately minimal. MV3 tears service workers down after roughly 30s idle,
 * so nothing stateful belongs here — no WebSocket, no polling loop. The side
 * panel is a real page and owns the live connection; the helper daemon owns
 * notifications.
 *
 * An extension cannot force its own side panel open on install —
 * sidePanel.open() requires a user gesture. Setting openPanelOnActionClick is
 * the closest available behaviour: one click on the toolbar icon opens DayDesk.
 */

export default defineBackground(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('DayDesk: could not set panel behavior', error));

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // First run needs the pairing token from ~/.daydesk/token, which is
      // easier to explain on a full page than in the narrow panel.
      void chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html') });
    }
  });
});
