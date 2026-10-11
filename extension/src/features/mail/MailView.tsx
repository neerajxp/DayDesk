/**
 * Mail container: owns folder selection, paging, search and the detail fetch.
 *
 * Presentational children stay pure — this is the only place in the mail
 * feature that talks to the API.
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  DayDeskApi,
} from '../../lib/api/client.js';
import type { FolderRole, MessageDetail, MessageSummary, SyncStatus } from '../../lib/api/types.js';
import { MessageList } from './MessageList.js';
import { MessageView } from './MessageView.js';
import { SearchBar } from './SearchBar.js';

const PAGE_SIZE = 50;

interface MailViewProps {
  readonly api: DayDeskApi;
  readonly status: SyncStatus | null;
  /** Bumped by the shell whenever a sync finishes, to trigger a reload. */
  readonly refreshKey: number;
}

export function MailView({ api, status, refreshKey }: MailViewProps) {
  const [role, setRole] = useState<FolderRole>('inbox');
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isLoadingBody, setIsLoadingBody] = useState(false);

  // ── Listing ─────────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const page = await api.messages({ role, limit: PAGE_SIZE });
      setMessages(page.messages);
      setTotal(page.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load messages.');
    } finally {
      setIsLoading(false);
    }
  }, [api, role]);

  const runSearch = useCallback(
    async (text: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.search(text, { limit: PAGE_SIZE });
        setMessages(result.hits);
        setTotal(result.total);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Search failed.');
      } finally {
        setIsLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (isSearching && query.trim()) {
      void runSearch(query);
    } else {
      void loadList();
    }
  }, [loadList, runSearch, isSearching, query, refreshKey]);

  // ── Detail ──────────────────────────────────────────────────────────────

  const openMessage = useCallback(
    async (message: MessageSummary) => {
      setSelectedId(message.id);
      setIsLoadingBody(true);
      setError(null);
      try {
        const detail = await api.message(message.id);
        setSelected(detail);
        // The body fetch upgrades the snippet server-side; reflect that locally
        // without refetching the whole page.
        setMessages((current) =>
          current.map((item) =>
            item.id === detail.id ? { ...item, snippet: detail.snippet, isSeen: detail.isSeen } : item,
          ),
        );
      } catch (cause) {
        setSelectedId(null);
        setError(cause instanceof Error ? cause.message : 'Could not open that message.');
      } finally {
        setIsLoadingBody(false);
      }
    },
    [api],
  );

  const closeMessage = useCallback(() => {
    setSelected(null);
    setSelectedId(null);
  }, []);

  // Escape closes the detail view — the panel is narrow and the back button is
  // easy to miss.
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMessage();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, closeMessage]);

  if (selected) {
    return <MessageView message={selected} onBack={closeMessage} />;
  }

  const counts = new Map(status?.folders.map((folder) => [folder.role, folder.messageCount]) ?? []);

  const emptyMessage = isSearching
    ? `Nothing in the archive matches “${query}”.`
    : role === 'inbox'
      ? 'No messages archived yet. DayDesk pulls the newest 1,000 on first sync.'
      : 'No sent messages archived yet.';

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Mail folders">
        {(['inbox', 'sent'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            className="tab"
            aria-selected={role === candidate && !isSearching}
            onClick={() => {
              setRole(candidate);
              setIsSearching(false);
              setQuery('');
            }}
          >
            {candidate === 'inbox' ? 'Inbox' : 'Sent'}
            <span className="tab__count">{counts.get(candidate) ?? 0}</span>
          </button>
        ))}
        {isSearching && (
          <button type="button" role="tab" className="tab" aria-selected>
            Results
            <span className="tab__count">{total}</span>
          </button>
        )}
      </div>

      <SearchBar
        value={query}
        onChange={setQuery}
        onSubmit={() => setIsSearching(query.trim().length > 0)}
        onClear={() => {
          setQuery('');
          setIsSearching(false);
        }}
      />

      <div className="scroller">
        {error && <p className="error-text" style={{ margin: 'var(--space-md)' }}>{error}</p>}
        <MessageList
          messages={messages}
          selectedId={selectedId}
          isLoading={isLoading || isLoadingBody}
          emptyMessage={emptyMessage}
          onSelect={openMessage}
        />
      </div>
    </>
  );
}
