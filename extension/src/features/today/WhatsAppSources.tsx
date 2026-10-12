/**
 * The "where DayDesk is listening" strip, and the WhatsApp watch-list editor
 * behind it.
 *
 * Only chats on this list are read. Entries are a chat or group name exactly
 * as WhatsApp shows it, or a phone number.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { isPhoneEntry } from '../../lib/whatsapp/parse.js';
import {
  CONNECTED_WITHIN_MS,
  onWhatsAppChange,
  readStatus,
  readWatchList,
  writeWatchList,
  type WhatsAppStatus,
} from '../../lib/whatsapp/settings.js';

const WHATSAPP_URL = 'https://web.whatsapp.com/';

function useWhatsAppState(): { watchList: readonly string[]; status: WhatsAppStatus | null } {
  const [watchList, setWatchList] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);

  useEffect(() => {
    const load = (): void => {
      void readWatchList().then(setWatchList);
      void readStatus().then(setStatus);
    };
    load();
    return onWhatsAppChange(load);
  }, []);

  return { watchList, status };
}

export function WhatsAppSources() {
  const { watchList, status } = useWhatsAppState();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(Date.now());

  // Re-evaluate "connected" as the heartbeat ages, without waiting for a change.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const isConnected = status !== null && now - status.at < CONNECTED_WITHIN_MS;
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

  const statusText = !isConnected
    ? 'Not open'
    : watchList.length === 0
      ? 'Open · watching nothing yet'
      : `Watching ${watchList.length} ${watchList.length === 1 ? 'chat' : 'chats'}`;

  return (
    <section className="sources" aria-label="Sources">
      <div className="sources__strip">
        <span className="sources__item">
          <span className="sources__dot" data-on="true" aria-hidden="true" />
          Yahoo Mail
        </span>
        <button
          type="button"
          className="sources__item sources__item--button"
          aria-expanded={isEditing}
          onClick={() => setIsEditing(!isEditing)}
        >
          <span className="sources__dot" data-on={isConnected} aria-hidden="true" />
          WhatsApp
          <span className="sources__detail">{statusText}</span>
          <span className="sources__chevron" aria-hidden="true">
            {isEditing ? '▴' : '▾'}
          </span>
        </button>
      </div>

      {isEditing && (
        <div className="watch">
          <p className="watch__intro">
            DayDesk reads only these chats in your WhatsApp Web tab, on this computer. Use the chat or group name exactly as
            WhatsApp shows it, or a phone number.
          </p>

          {!isConnected && (
            <p className="watch__notice">
              Keep{' '}
              <button type="button" className="watch__link" onClick={() => void chrome.tabs.create({ url: WHATSAPP_URL })}>
                web.whatsapp.com
              </button>{' '}
              open in a tab — DayDesk listens there.
            </p>
          )}
          {delivery && !delivery.ok && <p className="error-text">{delivery.message}</p>}

          {watchList.length > 0 && (
            <ul className="watch__list">
              {watchList.map((entry) => (
                <li key={entry} className="watch__entry">
                  <span className="watch__kind">{isPhoneEntry(entry) ? 'Number' : 'Chat'}</span>
                  <span className="watch__name">{entry}</span>
                  <button type="button" className="watch__remove" aria-label={`Stop watching ${entry}`} onClick={() => remove(entry)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="watch__add" onSubmit={(event) => void add(event)}>
            <input
              className="field__input"
              list="whatsapp-chat-suggestions"
              value={draft}
              maxLength={120}
              placeholder="e.g. Family, Office Admin, +91 98765 43210"
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
        </div>
      )}
    </section>
  );
}
