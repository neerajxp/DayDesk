# DayDesk

A local-first archive and reader for your Yahoo mail, surfaced in the Chrome side panel.

Your mail is stored on your own machine and nowhere else. DayDesk is **read-only** — it never
changes anything in your mailbox.

---

## Why there are two halves

Chrome extensions (Manifest V3) have no raw socket API, and Yahoo has no public REST mail API — IMAP
is the only read path. So DayDesk is:

| Part | What it does |
|---|---|
| `helper/` | A small Node daemon on your machine. Speaks IMAP to Yahoo, owns the SQLite archive, holds your credential in the macOS Keychain, serves the extension over loopback. |
| `extension/` | The Chrome MV3 extension. Side panel UI; talks only to the local helper, never to Yahoo. |

```
┌──────────────────────────┐   127.0.0.1 + bearer token   ┌─────────────────────────┐
│ Extension (side panel)   │◀──────  HTTP + WebSocket ───▶│ Helper daemon            │
└──────────────────────────┘                               │  · imapflow (read-only)  │
                                                            │  · SQLite + FTS5         │
            OS notifications ◀───────────────────────────────┤  · Keychain              │
                                                            └───────────┬──────────────┘
                                                                        │ IMAPS :993
                                                                        ▼
                                                            imap.mail.yahoo.com
```

---

## Setup

### 1. Install and build

```bash
npm install
npm run build
```

### 2. Get a Yahoo app password

Yahoo requires a **third-party app password** for IMAP — not your account password.
Generate one at [Yahoo Account Security](https://help.yahoo.com/kb/SLN15241.html) →
*Create app password*.

### 3. Verify IMAP works before building on it

```bash
DAYDESK_EMAIL=you@yahoo.com \
DAYDESK_APP_PASSWORD="xxxx xxxx xxxx xxxx" \
  npm run smoke --workspace=helper
```

This prints your mailboxes, how the Inbox and Sent roles resolve, how many messages IMAP will
actually serve, and where the 1,000-message floor would land. It writes nothing — to your mailbox or
to disk.

### 4. Start the helper

```bash
npm start --workspace=helper
```

It prints the loopback address and creates a pairing token at `~/.daydesk/token`.

Optionally install it as a login agent so you stop thinking about it:

```bash
./install/install-service.sh            # install
./install/install-service.sh --uninstall
```

### 5. Load the extension

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `extension/.output/chrome-mv3`
3. Click the **DayDesk** toolbar icon to open the side panel

### 6. Pair

The panel asks for two things, once each:

```bash
cat ~/.daydesk/token     # paste this into the panel
```

Then your Yahoo address and app password. The helper verifies the credential over IMAP and stores it
in your Keychain — it never reaches `chrome.storage` and is never written to the database.

---

## What DayDesk archives

Yahoo's standard IMAP serves only **the most recent 10,000 messages per folder** (changed June 2022).
Within that, DayDesk takes the **newest 1,000** of Inbox and Sent on first sync and anchors a *floor*
there.

- Everything above the floor is kept **permanently** — including after it rolls out of Yahoo's
  window. The local archive is the durable copy.
- Nothing below the floor is ever backfilled. Mail older than your first sync is not collected.
- The floor only ever moves **down**. Raise `initialBacklog` in `~/.daydesk/config.json` and the next
  sync extends the archive deeper; lowering it never discards what you already have.

Each folder's floor is stored as both a UID and a date. If Yahoo bumps `UIDVALIDITY` — which
invalidates every UID in a mailbox — the date is what lets DayDesk re-anchor instead of losing the
window.

---

## Read-only guarantees

DayDesk reads mail and nothing else. Concretely:

- Mailboxes are opened with IMAP **`EXAMINE`**, not `SELECT`. An examined mailbox will not accept
  flag changes, and the server must not set `\Seen` as a side effect of a body fetch. **Reading a
  message in DayDesk does not mark it read in Yahoo.**
- There is no code path that issues `STORE`, `APPEND`, `EXPUNGE` or `COPY`.
- There is no API endpoint that writes to your mailbox.

Read and starred state is *read* from Yahoo so the list reflects what you did elsewhere. It is never
written back.

---

## Security model

A loopback HTTP server is reachable by **every website you visit**, so three independent controls
apply:

1. **Bearer token** on every request — the actual access control. CORS is not one: it prevents a
   malicious page *reading* a response, but the request is still sent and side effects still happen.
2. **`Host` header validation** against loopback. This is the defense against DNS rebinding, where an
   attacker's domain resolves to `127.0.0.1` so their page's requests arrive here.
3. **Bound to `127.0.0.1` only** — never `0.0.0.0`.

Other decisions worth knowing:

- **The app password lives in the macOS Keychain** (`@napi-rs/keyring`). Not in an app-encrypted file:
  if the key is derivable by any process running as you, that is obfuscation rather than security.
- **HTML mail renders in a sandboxed iframe with no `allow-scripts`.** The extension page is
  privileged, so injecting attacker-authored HTML into it would be a serious XSS hole even behind a
  sanitiser. In the frame, scripts *cannot* execute rather than being filtered.
- **Remote images are blocked by default**, per message. Remote images in mail are routinely tracking
  pixels that report when and where you opened something.
- `~/.daydesk` is created `0700`; the token file is `0600`.

---

## Layout

```
daydesk/
├── helper/
│   ├── src/
│   │   ├── providers/     # Yahoo as a preset — not hardcoded into sync
│   │   ├── mail/          # anchor, reconcile, parse, sync, session, bodies
│   │   ├── store/         # schema + migrations, queries, FTS5 search
│   │   ├── secrets/       # keychain
│   │   ├── notify/        # OS notifications
│   │   ├── server/        # routes, auth hook, websocket
│   │   └── smoke.ts       # Phase 0 IMAP diagnostic
│   └── tests/
├── extension/
│   └── src/
│       ├── entrypoints/   # background worker, side panel, welcome page
│       ├── shell/         # panel shell + view routing
│       ├── features/      # mail, pairing
│       ├── lib/           # typed API client, formatting
│       └── styles/        # design tokens
└── install/               # launchd agent
```

Yahoo is a **provider preset**, the schema is **multi-account** from day one, and the API is
**namespaced** (`/api/mail/*`, `/api/system/*`) — all so adding a provider, an account or a second
surface later is additive rather than a refactor. None of that machinery is exercised in v1.

---

## Development

```bash
npm run helper          # helper, watch mode
npm run extension       # extension, HMR
npm test                # helper test suite
npm run typecheck       # both halves
```

Coverage: `cd helper && npx vitest run --coverage`

### Configuration

`~/.daydesk/config.json`, created on first write:

| Key | Default | Meaning |
|---|---|---|
| `port` | `4287` | Loopback port. Changing it also requires updating `host_permissions` in `wxt.config.ts`. |
| `initialBacklog` | `1000` | Messages to take on a folder's first sync. |
| `fetchBatchSize` | `100` | Messages per IMAP FETCH batch. |
| `reconcileIntervalMinutes` | `15` | How often to poll for deletions and flag changes (IDLE only reports arrivals). |
| `osNotifications` | `true` | Notify on new mail when no panel is connected. |

Env overrides: `DAYDESK_PORT`, `DAYDESK_BACKLOG`, `DAYDESK_HOME`, `DAYDESK_LOG_LEVEL`,
`DAYDESK_EXTENSION_ORIGIN`.

### Pinning the extension origin

Until the extension is loaded you don't know its ID, so CORS defaults to any `chrome-extension://`
origin. Once you have the ID, pin it:

```bash
DAYDESK_EXTENSION_ORIGIN="chrome-extension://<your-id>" npm start --workspace=helper
```

The bearer token is the real control either way.

---

## Not in v1

Other folders · other accounts · other providers · OAuth2 · sending or replying · attachment download
· writing flags back to Yahoo · backfill of history older than first sync.

---

## Licence

AGPL-3.0-or-later. DayDesk depends on [`imapflow`](https://github.com/postalsys/imapflow), whose npm
build is AGPL; an MIT build is available to Postal Systems subscribers as `@postalsys/imapflow` if
you need a permissive licence.
# DayDesk
