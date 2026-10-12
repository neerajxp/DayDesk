/**
 * Day / Night switch in the header: a sun or moon showing the theme in effect,
 * opening a three-way choice — Auto (follow the Mac), Day, Night.
 */

import { useEffect, useRef, useState } from 'react';
import { setPreference, useTheme, type ThemePreference } from '../../lib/theme.js';
import './theme.css';

const OPTIONS: readonly { value: ThemePreference; label: string; detail: string }[] = [
  { value: 'auto', label: 'Auto', detail: 'Match your Mac' },
  { value: 'light', label: 'Day', detail: 'Warm paper' },
  { value: 'dark', label: 'Night', detail: 'Deep ink' },
];

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

  const choose = (value: ThemePreference): void => {
    setPreference(value);
    setIsOpen(false);
  };

  return (
    <div className="theme-menu" ref={rootRef}>
      <button
        type="button"
        className="theme-menu__button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Theme: ${OPTIONS.find((option) => option.value === preference)?.label}. Change theme.`}
        title="Day / Night"
        onClick={() => setIsOpen(!isOpen)}
      >
        {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
        {preference === 'auto' && <span className="theme-menu__auto" aria-hidden="true">A</span>}
      </button>

      {isOpen && (
        <div className="theme-menu__list" role="menu" aria-label="Theme">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={preference === option.value}
              className="theme-menu__option"
              onClick={() => choose(option.value)}
            >
              <span className="theme-menu__label">{option.label}</span>
              <span className="theme-menu__detail">{option.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
