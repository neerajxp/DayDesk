/**
 * Panel shell.
 *
 * Owns the connection lifecycle and decides which view the panel shows:
 * helper-down, token entry, account pairing, or mail. Views are looked up by
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
import { MailView } from '../features/mail/MailView.js';

type ViewKey = 'loading' | 'helper-down' | 'needs-token' | 'needs-account' | 'mail';

export function PanelShell() {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>('loading');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [transientError, setTransientError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Rebuilt only when the token changes; MailView depends on its identity.
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
      setView(current.isPaired ? 'mail' : 'needs-account');
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
        // Only reload the list if the sync actually changed something.
        if (event.added > 0 || event.removed > 0) setRefreshKey((key) => key + 1);
        break;
      case 'sync:error':
        setIsSyncing(false);
        setTransientError(event.message);
        break;
      case 'mail:new':
        setRefreshKey((key) => key + 1);
        break;
      default:
        break;
    }
  }, []);

  const isLive = useEvents(view === 'mail' ? token : null, onEvent);

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
      setRefreshKey((key) => key + 1);
    } catch (cause) {
      setTransientError(cause instanceof Error ? cause.message : 'Sync failed.');
    } finally {
      setIsSyncing(false);
    }
  }, [token]);

  // ── Render ──────────────────────────────────────────────────────────────

  const inboxFolder = status?.folders.find((folder) => folder.role === 'inbox');
  const lastError = transientError ?? status?.lastError ?? null;

  return (
    <div className="panel">
      <header className="masthead">
        <h1 className="masthead__title">DayDesk</h1>
        <span
          className="pulse"
          data-live={isLive}
          data-syncing={isSyncing}
          role="status"
          aria-label={isSyncing ? 'Syncing' : isLive ? 'Connected' : 'Not connected'}
        />
        <span className="masthead__account">{status?.accountEmail ?? ''}</span>
      </header>

      {view === 'mail' && api ? (
        <MailView api={api} status={status} refreshKey={refreshKey} />
      ) : (
        <>
          <div />
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
          <div />
        </>
      )}

      {view === 'mail' && (
        <footer className={`statusbar${lastError ? ' statusbar--error' : ''}`}>
          {lastError ? (
            <span>{lastError}</span>
          ) : (
            <span>
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
