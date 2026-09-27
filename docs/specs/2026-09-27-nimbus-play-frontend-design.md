# Nimbus Play Frontend (Prototype)

Date: 2026-09-27
Repo: `cloud-gaming/web/`, served by the existing backend.

## Intent

An Android user should be able to play on their cloud VM without touching Windows,
AWS, or an IP address. They open the site on their phone, sign up, press one button,
wait, then tap a link that opens Artemis already paired. The only manual step is
installing the Artemis APK once.

Success: a new user goes from "never heard of this" to streaming, on a phone, using
only this page and the APK it links to.

Not in scope: billing, admin, a games catalogue, a paired-device manager, anything
desktop-first.

## Decisions

- **React + Vite + TypeScript**, built to static files. The user asked for React.
- **Served by the backend** (`@fastify/static` from `web/dist`), so the app and API
  share one origin. No CORS, no mixed content, and when the domain and HTTPS land,
  both move together with no code change. A domain is therefore not a prerequisite.
- **Brand: Nimbus Play**, retro-arcade styling.
- **No state library, no router.** One page, a handful of states, `useState` and a
  polling hook are enough.

## Screens (one page, five states)

| State | What the user sees |
|---|---|
| `auth` | Nimbus Play logo, email + password, toggle between Log in / Sign up, and the Artemis install instructions below the fold |
| `idle` | `PLAYER 1 READY`, a big **START GAMING** button, install instructions |
| `starting` | `BOOTING…` with a loading bar, an explanation that the first start takes a few minutes, and a **Stop** escape hatch |
| `ready` | `READY — PRESS CONNECT`, a **CONNECT** button, the PIN/passphrase fallback, and **STOP** |
| `failed` | The backend's error message in plain text, plus **TRY AGAIN** |

## Flow

1. `POST /auth/register` or `/auth/login` → token in `localStorage`.
2. On load with a token: `GET /sessions/current`. 404 means `idle`; otherwise use the
   returned status. A 401 anywhere clears the token and returns to `auth`.
3. **START GAMING** → `POST /sessions/start`, then poll `GET /sessions/current` every
   5s while the status is `starting` or `stopping`. Stop polling on `ready`, `stopped`
   or `failed`.
4. **CONNECT** → `POST /pairing/link` at tap time (the link lives ~3 minutes), then
   `window.location.href = link`. Show the returned `pin` and `passphrase` underneath
   for anyone who can't use the link, with a short note that it works only in Artemis.
5. **STOP** → `POST /sessions/stop`, return to `idle`.

## Instructions section

Always visible when logged out or idle, collapsed once a session is running:

1. Install Artemis from `github.com/Swanand01/moonlight-android/releases/latest`
   (the page links straight to the APK), and allow installs from the browser.
2. Press START GAMING and wait for READY.
3. Press CONNECT; Artemis opens and pairs itself.
4. Press STOP when finished, so the VM isn't left running.

## Visual language

- **Type:** Press Start 2P for logo, headings, buttons and status; system sans for
  body text, form fields and errors (a pixel font is unreadable in paragraphs).
- **Palette:** near-black background, cyan and magenta neon accents, amber warnings,
  white body text.
- **Chrome:** chunky buttons with hard offset shadows, a faint scanline overlay, a
  blinking cursor next to status text.
- **Restraint:** retro styling stays on chrome and headings. Errors and instructions
  stay plain.
- **Mobile first:** single column, full-width tap targets at least 44px tall; on
  desktop the same column, centred, max ~420px.

## Errors

- **Network or 5xx:** "Couldn't reach the server" with Retry; the app keeps its state.
- **401:** token cleared, back to `auth`, with "Please log in again".
- **409 from pairing:** "Your PC isn't ready yet", re-check the session.
- **Failed session:** show `session.error` verbatim under a plain heading; the backend
  already returns readable messages.

## Files

```
web/
  index.html
  package.json            vite, react, typescript
  vite.config.ts          build -> web/dist
  src/main.tsx
  src/App.tsx             state machine + screens
  src/api.ts              typed fetch helpers, token handling
  src/usePolling.ts       interval hook that stops on terminal states
  src/components/        Button, Panel, StatusLine, Instructions
  src/styles.css          tokens + retro chrome
```

Backend: add `@fastify/static` serving `web/dist` at `/`, after the API routes so it
can't shadow them. `deploy-backend.sh` runs `npm ci && npm run build` in `web/` and
ships `web/dist`.

## Testing

- Build locally, point it at the deployed backend, and walk the whole flow with a real
  VM: sign up, start, wait, connect, stop.
- Check the states that are awkward to reach by hand (failed session, expired token)
  by stubbing the API responses in the browser.
- Phone check: layout at 360px wide, tap targets, and the `art://` link actually
  opening Artemis. That last one needs the user's device.

## Follow-ups (not now)

- HTTPS and the real domain (`nimbusplay.gg`), which this design is already compatible with.
- Auto-stop, so a forgotten VM stops billing.
- Password reset, and a paired-devices view.
