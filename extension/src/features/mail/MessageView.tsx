/**
 * Message detail.
 *
 * Two security decisions carry most of the weight here:
 *
 * 1. HTML bodies are never injected into the panel's own DOM. The extension
 *    page is privileged — it holds the pairing token and can call chrome APIs —
 *    so dangerouslySetInnerHTML on attacker-authored mail would be a serious
 *    XSS hole even behind a sanitiser. Instead the HTML goes into a sandboxed
 *    iframe with no allow-scripts, where script execution is impossible rather
 *    than merely filtered.
 *
 * 2. Remote content is blocked by default via the frame's own CSP. Remote
 *    images in mail are routinely tracking pixels that report when and where a
 *    message was opened; loading them is opt-in per message.
 */

import { useMemo, useState } from 'react';
import type { MessageDetail } from '../../lib/api/types.js';
import { formatAddress, formatAddressList, formatBytes, formatFullDate } from '../../lib/format.js';

interface MessageViewProps {
  readonly message: MessageDetail;
  readonly onBack: () => void;
}

/**
 * Wrap a mail HTML body in a minimal document with a restrictive CSP.
 *
 * `default-src 'none'` means nothing loads unless explicitly allowed below.
 * Inline styles are permitted because mail depends on them for all formatting.
 */
function buildFrameDocument(html: string, allowRemoteImages: boolean): string {
  const imgSrc = allowRemoteImages ? "img-src data: https: http:;" : 'img-src data:;';
  const csp = `default-src 'none'; style-src 'unsafe-inline'; ${imgSrc} font-src data:;`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    font-family: ui-sans-serif, -apple-system, system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #1c1917;
    background: transparent;
    overflow-wrap: anywhere;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e7e5e4; }
    a { color: #fbbf24; }
  }
  img, table { max-width: 100% !important; height: auto; }
  table { border-collapse: collapse; }
  blockquote {
    margin: 0 0 0 0.75rem;
    padding-left: 0.75rem;
    border-left: 2px solid currentColor;
    opacity: 0.7;
  }
</style>
</head>
<body>${html}</body>
</html>`;
}

export function MessageView({ message, onBack }: MessageViewProps) {
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const [preferHtml, setPreferHtml] = useState(!message.bodyText);

  const showHtml = preferHtml && message.bodyHtml !== null;

  const frameDocument = useMemo(
    () => (showHtml && message.bodyHtml ? buildFrameDocument(message.bodyHtml, allowRemoteImages) : ''),
    [showHtml, message.bodyHtml, allowRemoteImages],
  );

  return (
    <article className="detail">
      <header className="detail__header">
        <button type="button" className="detail__back" onClick={onBack}>
          ← Back to Today
        </button>
        <h1 className="detail__subject">{message.subject || '(no subject)'}</h1>
        <div className="detail__meta">
          <div className="detail__meta-row">
            <span className="detail__meta-label">From</span>
            <span className="detail__meta-value">
              {formatAddress(message.from)}
              {message.from?.name && message.from.address ? ` · ${message.from.address}` : ''}
            </span>
          </div>
          <div className="detail__meta-row">
            <span className="detail__meta-label">To</span>
            <span className="detail__meta-value">{formatAddressList(message.to)}</span>
          </div>
          {message.cc.length > 0 && (
            <div className="detail__meta-row">
              <span className="detail__meta-label">Cc</span>
              <span className="detail__meta-value">{formatAddressList(message.cc)}</span>
            </div>
          )}
          <div className="detail__meta-row">
            <span className="detail__meta-label">Date</span>
            <span className="detail__meta-value">{formatFullDate(message.date ?? message.internalDate)}</span>
          </div>
        </div>
      </header>

      <div className="detail__body">
        {message.bodyHtml && message.bodyText && (
          <div className="detail__notice">
            <span>{showHtml ? 'Showing the formatted version.' : 'Showing the plain-text version.'}</span>
            <button type="button" className="button button--quiet" onClick={() => setPreferHtml(!preferHtml)}>
              {showHtml ? 'Show plain text' : 'Show formatted'}
            </button>
          </div>
        )}

        {showHtml && !allowRemoteImages && (
          <div className="detail__notice">
            <span>Remote images blocked to prevent read tracking.</span>
            <button type="button" className="button button--quiet" onClick={() => setAllowRemoteImages(true)}>
              Load images
            </button>
          </div>
        )}

        {showHtml ? (
          <iframe
            className="detail__frame"
            title="Message body"
            // No allow-scripts: scripts in mail cannot execute at all.
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={frameDocument}
          />
        ) : (
          <pre className="detail__text">{message.bodyText ?? '(This message has no readable body.)'}</pre>
        )}

        {message.attachments.length > 0 && (
          <section className="detail__attachments">
            <h3>
              {message.attachments.length} attachment{message.attachments.length === 1 ? '' : 's'}
            </h3>
            {message.attachments.map((attachment) => (
              <div key={attachment.id} className="attachment">
                <span>{attachment.filename}</span>
                <span className="attachment__size">{formatBytes(attachment.size)}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </article>
  );
}
