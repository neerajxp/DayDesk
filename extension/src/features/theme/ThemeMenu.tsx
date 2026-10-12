/**
 * Appearance menu in the header. The button is a sun or moon for the mode in
 * effect; the menu sets the mode (Auto / Day / Night) and the style — a whole
 * look for the board, each with its own day and night palette.
 */

import { useEffect, useRef, useState } from 'react';
import { setPreference, useTheme, type ThemePreference } from '../../lib/theme.js';
import { setStyle, STYLES, useStyle, type StyleInfo } from '../../lib/style.js';
import './theme.css';

const MODES: readonly { value: ThemePreference; label: string; detail: string }[] = [
  { value: 'auto', label: 'Auto', detail: 'Match your Mac' },
  { value: 'light', label: 'Day', detail: 'Always light' },
  { value: 'dark', label: 'Night', detail: 'Always dark' },
];

/** A thumbnail of the style: its paper, ink, accent and display face. */
function StyleSwatch({ style }: { style: StyleInfo }) {
  const { paper, ink, accent, font } = style.swatch;
  return (
    <span className="style-swatch" style={{ background: paper, color: ink, fontFamily: font }} aria-hidden="true">
      <span className="style-swatch__rail" style={{ background: accent }} />
      Aa
    </span>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z" />
    </svg>
  );
}

export function ThemeMenu() {
  const { preference, theme } = useTheme();
  const style = useStyle();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="theme-menu" ref={rootRef}>
      <button
        type="button"
        className="theme-menu__button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Appearance: ${MODES.find((mode) => mode.value === preference)?.label}, ${
          STYLES.find((item) => item.id === style)?.name
        } style. Change appearance.`}
        title="Appearance"
        onClick={() => setIsOpen(!isOpen)}
      >
        {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
        {preference === 'auto' && <span className="theme-menu__auto" aria-hidden="true">A</span>}
      </button>

      {isOpen && (
        <div className="theme-menu__list" role="menu" aria-label="Appearance">
          <p className="theme-menu__heading" id="appearance-mode">
            Mode
          </p>
          <div className="mode-switch" role="group" aria-labelledby="appearance-mode">
            {MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                role="menuitemradio"
                aria-checked={preference === mode.value}
                title={mode.detail}
                className="mode-switch__option"
                onClick={() => setPreference(mode.value)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <p className="theme-menu__heading" id="appearance-style">
            Style
          </p>
          <div role="group" aria-labelledby="appearance-style">
            {STYLES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={style === item.id}
                className="theme-menu__option"
                onClick={() => setStyle(item.id)}
              >
                <StyleSwatch style={item} />
                <span className="theme-menu__label">{item.name}</span>
                <span className="theme-menu__detail">{item.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
