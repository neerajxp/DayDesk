/**
 * Panel shell.
 *
 * Owns the connection lifecycle and decides which view the panel shows:
 * helper-down, token entry, account pairing, or the Today board. Views are looked up by
 * key rather than nested in conditionals, so adding a second DayDesk surface
 * later means registering a view — not restructuring this file.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkHealth,
  createApi,
  HelperDownError,
  NotPairedError,
  UnauthorizedError,
  type DayDeskApi,
} from '../lib/api/client.js';
import { clearToken, readToken, writeToken } from '../lib/api/storage.js';
import { useEvents } from '../lib/api/useEvents.js';
import type { ServerEvent, SyncStatus } from '../lib/api/types.js';
import { formatRelativeSync } from '../lib/format.js';
import { AccountStage, TokenStage } from '../features/pairing/PairingScreen.js';
import { TodayView } from '../features/today/TodayView.js';
import { SourcesButton } from '../features/sources/SourcesButton.js';
import { SourcesSheet } from '../features/sources/SourcesSheet.js';
import { useWhatsAppState } from '../features/sources/useWhatsAppState.js';
import { ThemeMenu } from '../features/theme/ThemeMenu.js';

type ViewKey = 'loading' | 'helper-down' | 'needs-token' | 'needs-account' | 'today';

export function PanelShell() {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>('loading');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [transientError, setTransientError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [tasksKey, setTasksKey] = useState(0);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const whatsApp = useWhatsAppState();

  // Rebuilt only when the token changes; TodayView depends on its identity.
  const api = useMemo<DayDeskApi | null>(() => (token ? createApi(token) : null), [token]);

  /** Work out which view applies, from the helper's actual state. */
  const resolve = useCallback(async (): Promise<void> => {
    const stored = await readToken();

    if (!(await checkHealth())) {
      setView('helper-down');
      return;
    }

    if (!stored) {
      setView('needs-token');
      return;
    }

    try {
      const current = await createApi(stored).status();
      setToken(stored);
      setStatus(current);
      setIsSyncing(current.isSyncing);
      setView(current.isPaired ? 'today' : 'needs-account');
    } catch (cause) {
      if (cause instanceof UnauthorizedError) {
        // Stored token no longer matches the helper's — most likely ~/.daydesk
        // was cleared. Drop it and ask again.
        await clearToken();
        setToken(null);
        setView('needs-token');
        return;
      }
      if (cause instanceof HelperDownError) {
        setView('helper-down');
        return;
      }
      if (cause instanceof NotPairedError) {
        setToken(stored);
        setView('needs-account');
        return;
      }
      setTransientError(cause instanceof Error ? cause.message : 'Something went wrong.');
      setView('helper-down');
    }
  }, []);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  // ── Live events ─────────────────────────────────────────────────────────

  const onEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'status':
        setStatus(event.status);
        setIsSyncing(event.status.isSyncing);
        break;
      case 'sync:started':
        setIsSyncing(true);
        break;
      case 'sync:finished':
        setIsSyncing(false);
        break;
      case 'sync:error':
        setIsSyncing(false);
        setTransientError(event.message);
        break;
      // New mail matters to the board only once it becomes a task.
      case 'tasks:changed':
        setTasksKey((key) => key + 1);
        break;
      default:
        break;
    }
  }, []);

  const isLive = useEvents(view === 'today' ? token : null, onEvent);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleTokenPaired = useCallback(
    async (next: string) => {
      await writeToken(next);
      setToken(next);
      await resolve();
    },
    [resolve],
  );

  const handleResetToken = useCallback(async () => {
    await clearToken();
    setToken(null);
    setView('needs-token');
  }, []);

  const handleSync = useCallback(async () => {
    if (!token) return;
    setTransientError(null);
    setIsSyncing(true);
    try {
      const result = await createApi(token).sync();
      setStatus(result.status);
      setTasksKey((key) => key + 1);
    } catch (cause) {
      setTransientError(cause instanceof Error ? cause.message : 'Sync failed.');
    } finally {
      setIsSyncing(false);
    }
  }, [token]);

  // ── Render ──────────────────────────────────────────────────────────────

  const inboxFolder = status?.folders.find((folder) => folder.role === 'inbox');
  const lastError = transientError ?? status?.lastError ?? null;
  const isMailOn = status?.isConnected === true && !status.lastError;
  const closeSources = useCallback(() => setIsSourcesOpen(false), []);

  return (
    <div className="panel">
      <div className="masthead-area">
        <header className="masthead">
          <h1 className="masthead__title">DayDesk</h1>
          <span
            className="pulse"
            data-live={isLive}
            data-syncing={isSyncing}
            role="status"
            aria-label={isSyncing ? 'Syncing' : isLive ? 'Connected' : 'Not connected'}
          />
          {view === 'today' && (
            <SourcesButton
              isMailOn={isMailOn}
              isWhatsAppOn={whatsApp.isConnected && whatsApp.watchList.length > 0}
              isOpen={isSourcesOpen}
              onToggle={() => setIsSourcesOpen((open) => !open)}
            />
          )}
          <ThemeMenu />
        </header>

        {view === 'today' && isSourcesOpen && (
          <SourcesSheet
            accountEmail={status?.accountEmail ?? null}
            isMailOn={isMailOn}
            whatsApp={whatsApp}
            onClose={closeSources}
          />
        )}
      </div>

      <main className="panel__body">
        {view === 'today' && api ? (
          <TodayView api={api} refreshKey={tasksKey} />
        ) : (
          <div className="scroller">
            {view === 'loading' && (
              <div className="state">
                <p className="state__text">Looking for the DayDesk helper…</p>
              </div>
            )}

            {view === 'helper-down' && (
              <div className="state state--error">
                <h2 className="state__title">The helper isn’t running</h2>
                <p className="state__text">
                  DayDesk reads your mail from a small process on your own machine. Nothing is shown
                  here until it’s up.
                </p>
                <p className="state__text">
                  Start it with <span className="state__code">npm start --workspace=helper</span>
                </p>
                {transientError && <p className="error-text">{transientError}</p>}
                <button type="button" className="button" onClick={() => void resolve()}>
                  Try again
                </button>
              </div>
            )}

            {view === 'needs-token' && <TokenStage onPaired={(next) => void handleTokenPaired(next)} />}

            {view === 'needs-account' && token && (
              <AccountStage
                token={token}
                onPaired={() => void resolve()}
                onResetToken={() => void handleResetToken()}
              />
            )}
          </div>
        )}
      </main>

      {view === 'today' && (
        <footer className={`statusbar${lastError ? ' statusbar--error' : ''}`}>
          {lastError ? (
            <span>{lastError}</span>
          ) : (
            <span title={status?.accountEmail ?? undefined}>
              {inboxFolder?.messageCount ?? 0} archived · {formatRelativeSync(inboxFolder?.lastSyncAt ?? null)}
            </span>
          )}
          <span className="statusbar__spacer" />
          <button
            type="button"
            className="statusbar__action"
            onClick={() => void handleSync()}
            disabled={isSyncing}
          >
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </button>
        </footer>
      )}
    </div>
  );
}
