/**
 * Header pill: one glance says whether mail and WhatsApp are being heard.
 * A click opens the sources sheet, where the one-time setup lives.
 */

interface SourcesButtonProps {
  readonly isMailOn: boolean;
  readonly isWhatsAppOn: boolean;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}

export function SourcesButton({ isMailOn, isWhatsAppOn, isOpen, onToggle }: SourcesButtonProps) {
  const describe = (name: string, isOn: boolean): string => `${name} ${isOn ? 'connected' : 'not connected'}`;

  return (
    <button
      type="button"
      className="sources-button"
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      aria-label={`Sources: ${describe('Mail', isMailOn)}, ${describe('WhatsApp', isWhatsAppOn)}. Open settings.`}
      onClick={onToggle}
    >
      <span className="sources-button__item">
        <span className="source-dot" data-on={isMailOn} aria-hidden="true" />
        Mail
      </span>
      <span className="sources-button__item">
        <span className="source-dot" data-on={isWhatsAppOn} aria-hidden="true" />
        WhatsApp
      </span>
      <svg className="sources-button__chevron" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 3.5l3 3 3-3" />
      </svg>
    </button>
  );
}
