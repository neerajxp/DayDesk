/**
 * Pairing, in two stages.
 *
 * Stage 1 is the helper's pairing token, pasted from ~/.daydesk/token. Without
 * it the panel cannot call the helper at all.
 *
 * Stage 2 is the Yahoo account. The app password is posted straight to the
 * helper, which verifies it over IMAP and stores it in the macOS Keychain — it
 * is never written to chrome.storage and never kept in the extension.
 */

import { useState } from 'react';
import { createApi } from '../../lib/api/client.js';

interface TokenStageProps {
  readonly onPaired: (token: string) => void;
}

export function TokenStage({ onPaired }: TokenStageProps) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setIsChecking(true);
    setError(null);

    try {
      // Validate before storing, so a typo is caught here rather than
      // surfacing as a mysterious 401 on every later request.
      await createApi(token.trim()).status();
      onPaired(token.trim());
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === 'UnauthorizedError'
          ? 'That token was rejected. Check ~/.daydesk/token and paste it again.'
          : 'Could not reach the DayDesk helper. Is it running?',
      );
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <div className="state">
      <h2 className="state__title">Connect to your helper</h2>
      <p className="state__text">
        DayDesk keeps your mail on your own machine. Paste the pairing token so this panel can talk to
        the helper running locally.
      </p>
      <p className="state__text">
        Find it with <span className="state__code">cat ~/.daydesk/token</span>
      </p>

      <form className="form" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="pairing-token">
            Pairing token
          </label>
          <input
            id="pairing-token"
            className="field__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" className="button" disabled={isChecking || token.trim().length === 0}>
          {isChecking ? 'Checking…' : 'Connect'}
        </button>
      </form>
    </div>
  );
}

interface AccountStageProps {
  readonly token: string;
  readonly onPaired: () => void;
  readonly onResetToken: () => void;
}

export function AccountStage({ token, onPaired, onResetToken }: AccountStageProps) {
  const [email, setEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setIsPairing(true);
    setError(null);

    try {
      await createApi(token).pair(email.trim(), appPassword);
      onPaired();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pairing failed.');
    } finally {
      setIsPairing(false);
    }
  }

  return (
    <div className="state">
      <h2 className="state__title">Add your Yahoo account</h2>
      <p className="state__text">
        Yahoo has no public mail API, so DayDesk reads over IMAP using a third-party app password —
        not your account password.
      </p>
      <p className="state__text">
        <a
          href="https://help.yahoo.com/kb/SLN15241.html"
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: 'var(--accent-strong)' }}
        >
          Generate one in Yahoo Account Security ↗
        </a>
      </p>

      <form className="form" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="account-email">
            Yahoo address
          </label>
          <input
            id="account-email"
            className="field__input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="account-password">
            App password
          </label>
          <input
            id="account-password"
            className="field__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={appPassword}
            onChange={(event) => setAppPassword(event.target.value)}
            required
          />
          <span className="field__hint">
            Stored in your macOS Keychain by the helper. Spaces are fine — they get stripped.
          </span>
        </div>

        {error && <p className="error-text">{error}</p>}

        <button
          type="submit"
          className="button"
          disabled={isPairing || email.trim().length === 0 || appPassword.length === 0}
        >
          {isPairing ? 'Verifying with Yahoo…' : 'Connect account'}
        </button>

        <button type="button" className="button button--quiet" onClick={onResetToken}>
          Use a different pairing token
        </button>
      </form>
    </div>
  );
}
