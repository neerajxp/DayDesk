/**
 * Sources sheet — the one-time setup, dropped down from the header.
 *
 * Mail: which account is connected. WhatsApp: whether the tab is listening,
 * and the watch list of chats DayDesk may read. Opened rarely, so it overlays
 * the board instead of taking space on it.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { isPhoneEntry } from '../../lib/whatsapp/parse.js';
import { writeWatchList } from '../../lib/whatsapp/settings.js';
import type { WhatsAppState } from './useWhatsAppState.js';
import './sources.css';

const WHATSAPP_URL = 'https://web.whatsapp.com/';

interface SourcesSheetProps {
  readonly accountEmail: string | null;
  /** "Yahoo Mail" or "Gmail". */
  readonly providerName: string | null;
  readonly isMailOn: boolean;
  /** Disconnect the email account, so another can be connected. */
  readonly onDisconnect: () => Promise<void>;
  readonly whatsApp: WhatsAppState;
  readonly onClose: () => void;
}

export function SourcesSheet({ accountEmail, providerName, isMailOn, onDisconnect, whatsApp, onClose }: SourcesSheetProps) {
  const { watchList, status, isConnected } = whatsApp;
  const [draft, setDraft] = useState('');
  const [isConfirmingChange, setIsConfirmingChange] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const disconnect = async (): Promise<void> => {
    setIsDisconnecting(true);
    setChangeError(null);
    try {
      await onDisconnect();
    } catch (cause) {
      setChangeError(cause instanceof Error ? cause.message : 'Could not disconnect the account.');
      setIsDisconnecting(false);
    }
  };
  const inputRef = useRef<HTMLInputElement>(null);

  // Escape closes; focus lands on the one thing you came here to do.
  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const delivery = status?.lastDelivery ?? null;
  const suggestions = (status?.chats ?? []).filter(
    (chat) => !watchList.some((entry) => entry.toLowerCase() === chat.toLowerCase()),
  );

  const add = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!draft.trim()) return;
      await writeWatchList([...watchList, draft]);
      setDraft('');
    },
    [draft, watchList],
  );

  const remove = useCallback(
    (entry: string) => void writeWatchList(watchList.filter((item) => item !== entry)),
    [watchList],
  );

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="sources-title">
        <header className="sheet__header">
          <h2 className="sheet__title" id="sources-title">
            Sources
          </h2>
          <button type="button" className="sheet__done" onClick={onClose}>
            Done
          </button>
        </header>

        <div className="sheet__body">
          <section className="source" aria-labelledby="source-mail">
            <h3 className="source__name" id="source-mail">
              <span className="source-dot" data-on={isMailOn} aria-hidden="true" />
              Email{providerName ? ` · ${providerName}` : ''}
            </h3>
            <p className="source__detail">
              {accountEmail ?? 'No account'} · {isMailOn ? 'connected' : 'not connected'} · last 30 days of inbox
            </p>

            {!isConfirmingChange ? (
              <button type="button" className="source__link source__link--quiet" onClick={() => setIsConfirmingChange(true)}>
                Change account…
              </button>
            ) : (
              <div className="source__confirm" role="alert">
                <p className="source__detail">
                  DayDesk watches one email account. Switching removes this account’s archived mail, its tasks and
                  its saved password from this Mac. Your mailbox itself is not touched.
                </p>
                {changeError && <p className="error-text">{changeError}</p>}
                <div className="source__confirm-actions">
                  <button type="button" className="button" disabled={isDisconnecting} onClick={() => void disconnect()}>
                    {isDisconnecting ? 'Disconnecting…' : 'Disconnect and switch'}
                  </button>
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={isDisconnecting}
                    onClick={() => setIsConfirmingChange(false)}
                  >
                    Keep {providerName ?? 'this account'}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="source" aria-labelledby="source-whatsapp">
            <h3 className="source__name" id="source-whatsapp">
              <span className="source-dot" data-on={isConnected} aria-hidden="true" />
              WhatsApp
            </h3>
            <p className="source__detail">
              {isConnected ? (
                'Listening in your WhatsApp Web tab.'
              ) : (
                <>
                  Keep{' '}
                  <button type="button" className="source__link" onClick={() => void chrome.tabs.create({ url: WHATSAPP_URL })}>
                    web.whatsapp.com
                  </button>{' '}
                  open in a tab — DayDesk listens there.
                </>
              )}
            </p>
            {delivery && !delivery.ok && <p className="error-text">{delivery.message}</p>}

            <p className="source__hint">
              Only these chats are read. Use the chat or group name exactly as WhatsApp shows it, or a phone number.
            </p>

            {watchList.length === 0 ? (
              <p className="watch__empty">No chats watched yet.</p>
            ) : (
              <ul className="watch__list">
                {watchList.map((entry) => (
                  <li key={entry} className="watch__entry">
                    <span className="watch__kind">{isPhoneEntry(entry) ? 'Number' : 'Chat'}</span>
                    <span className="watch__name">{entry}</span>
                    <button
                      type="button"
                      className="watch__remove"
                      aria-label={`Stop watching ${entry}`}
                      onClick={() => remove(entry)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form className="watch__add" onSubmit={(event) => void add(event)}>
              <input
                ref={inputRef}
                className="field__input"
                list="whatsapp-chat-suggestions"
                value={draft}
                maxLength={120}
                placeholder="e.g. Family, +91 98765 43210"
                aria-label="Chat, group or number to watch"
                onChange={(event) => setDraft(event.target.value)}
              />
              <datalist id="whatsapp-chat-suggestions">
                {suggestions.map((chat) => (
                  <option key={chat} value={chat} />
                ))}
              </datalist>
              <button type="submit" className="button" disabled={!draft.trim()}>
                Watch
              </button>
            </form>
          </section>
        </div>
      </section>
    </>
  );
}
