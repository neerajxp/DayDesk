/**
 * A task's trail: everything else — emails and WhatsApp messages — that has
 * referred to the same piece of work, oldest first. This is where mail and
 * chat read as one conversation about one task.
 */

import type { RelatedItem } from '../../lib/api/types.js';
import { formatTrailTime } from '../../lib/tasks.js';

const RELATION_LABELS: Record<RelatedItem['relation'], string> = {
  followup: 'Follow-up',
  mention: 'Mentioned',
  'done-hint': 'Says done',
};

function trailWho(item: RelatedItem): string {
  if (item.isFromYou) return 'You';
  if (item.source === 'email') return item.from;
  return item.from ? `${item.label} · ${item.from}` : item.label;
}

interface TaskTrailProps {
  readonly items: readonly RelatedItem[];
  readonly onOpenEmail: (messageId: number) => void;
}

export function TaskTrail({ items, onOpenEmail }: TaskTrailProps) {
  if (items.length === 0) return null;

  return (
    <ol className="trail" aria-label="Also mentioned in">
      {items.map((item) => (
        <li key={`${item.source}-${item.refId}`} className="trail__item" data-source={item.source} data-relation={item.relation}>
          <span className="trail__dot" aria-hidden="true" />
          <div className="trail__body">
            <p className="trail__head">
              <span className="source-badge" data-source={item.source}>
                {item.source === 'email' ? 'Email' : 'WhatsApp'}
              </span>
              <span className="trail__who">{trailWho(item)}</span>
              <span className="trail__relation">{RELATION_LABELS[item.relation]}</span>
              <time className="trail__time" dateTime={item.at}>
                {formatTrailTime(item.at)}
              </time>
            </p>
            {item.source === 'email' ? (
              <button type="button" className="trail__text trail__text--link" onClick={() => onOpenEmail(item.refId)}>
                {item.label || '(no subject)'}
              </button>
            ) : (
              <p className="trail__text">“{item.text}”</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
