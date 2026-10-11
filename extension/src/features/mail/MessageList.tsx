import type { MessageSummary } from '../../lib/api/types.js';
import { formatAddress, formatListDate } from '../../lib/format.js';

interface MessageListProps {
  readonly messages: readonly MessageSummary[];
  readonly selectedId: number | null;
  readonly isLoading: boolean;
  readonly emptyMessage: string;
  readonly onSelect: (message: MessageSummary) => void;
}

export function MessageList({
  messages,
  selectedId,
  isLoading,
  emptyMessage,
  onSelect,
}: MessageListProps) {
  if (isLoading && messages.length === 0) {
    return (
      <ul className="message-list" aria-busy="true">
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index} className="message-row" style={{ cursor: 'default' }}>
            <span className="message-row__marker" />
            <div className="message-row__body">
              <div className="skeleton" style={{ width: '40%' }} />
              <div className="skeleton" style={{ width: '85%', marginTop: '0.4rem' }} />
              <div className="skeleton" style={{ width: '65%', marginTop: '0.3rem' }} />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="state">
        <p className="state__text">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className="message-list">
      {messages.map((message) => (
        <li key={message.id}>
          <button
            type="button"
            className="message-row"
            data-unread={!message.isSeen}
            aria-current={message.id === selectedId}
            onClick={() => onSelect(message)}
          >
            <span className="message-row__marker" aria-hidden="true" />
            <div className="message-row__body">
              <div className="message-row__head">
                <span className="message-row__sender">{formatAddress(message.from)}</span>
                <time className="message-row__date" dateTime={message.internalDate}>
                  {formatListDate(message.internalDate)}
                </time>
              </div>
              <h2 className="message-row__subject">{message.subject || '(no subject)'}</h2>
              {message.snippet && <p className="message-row__snippet">{message.snippet}</p>}
              {(message.hasAttachments || message.isFlagged) && (
                <div className="message-row__badges">
                  {message.hasAttachments && <span className="badge">📎 attachment</span>}
                  {message.isFlagged && <span className="badge">★ starred</span>}
                </div>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
