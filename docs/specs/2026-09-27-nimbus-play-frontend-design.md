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

- **React + Vite + TypeScript + Tailwind CSS 4**, built to static files. Tailwind 4 is
  CSS-first: theme tokens live in `src/index.css` under `@theme`, with no
  `tailwind.config.js`.
- **Served by the backend** (`@fastify/static` from `web/dist`), so the app and API
  share one origin. No CORS, no mixed content, and when the domain and HTTPS land,
  both move together with no code change. A domain is therefore not a prerequisite.
- **Brand: Nimbus Play**, retro-arcade styling.
- **No state library, no router.** One page, a handful of states, `useState` and a
  polling hook are enough.
- **Session in an httpOnly cookie**, not `localStorage`. The frontend never sees the
  token, so a compromised dependency can't steal one for later use. The frontend
  stores nothing and sends `credentials: 'include'`.

## Screens (one page, five states)

| State | What the user sees |
|---|---|
| `auth` | Nimbus Play logo, email + password, toggle between Log in / Sign up, and the Artemis install instructions below the fold |
| `idle` | `PLAYER 1 READY`, a big **START GAMING** button, install instructions |
| `starting` | `BOOTING…`, an explanation that the first start takes a few minutes, and a note that Stop appears once it's ready (EC2 refuses to stop a VM that is still coming up) |
| `ready` | `READY — PRESS CONNECT`, a **CONNECT** button, the PIN/passphrase fallback, and **STOP** |
| `failed` | The backend's error message in plain text, plus **TRY AGAIN** |

## Flow

1. `POST /auth/register` or `/auth/login` → backend replies `Set-Cookie: session=<token>`
   (`httpOnly`, `SameSite=Lax`, `Path=/`, `Secure` once HTTPS is on) as well as the
   token in the body, so the test script and any future mobile client keep working.
2. On load: `GET /me`. 401 means show `auth`; otherwise `GET /sessions/current`, where
   404 means `idle` and anything else gives the status. A 401 later returns to `auth`.
3. **START GAMING** → `POST /sessions/start`, then poll `GET /sessions/current` every
   5s while the status is `starting` or `stopping`. Stop polling on `ready`, `stopped`
   or `failed`.
4. **CONNECT** → `POST /pairing/link` at tap time (the link lives ~3 minutes), then
   `window.location.href = link`. Show the returned `pin` and `passphrase` underneath
   for anyone who can't use the link, with a short note that it works only in Artemis.
5. **STOP** → `POST /sessions/stop`, return to `idle`.
6. **Log out** → `POST /auth/logout` clears the cookie.

## Backend changes

- Register `@fastify/cookie`.
- `/auth/register` and `/auth/login` also set the session cookie; new `POST /auth/logout`
  clears it.
- `getAuthenticatedUserId` accepts the `session` cookie as well as the existing
  `Authorization: Bearer` header (header wins when both are present).
- Token lifetime drops from 30 days to 7 (`AUTH_TOKEN_TTL_SECONDS=604800`).
- `scripts/api-test.sh` gains checks: login sets an httpOnly cookie, a cookie-only
  request is accepted, and logout invalidates it.

## Instructions section

Three steps, shown when logged out or idle and hidden once a session is running:

1. First time here? Install the Artemis app on your phone (links to the release).
2. Press Start gaming, then Connect when your PC is ready.
3. Press Stop when you're finished, so your PC isn't left running.

Connect and Stop explain themselves at the moment they appear, so the steps stay short.

## Visual language

Dark console UI with neon accents: the dominant pattern in gaming products, and it
keeps the text people must read legible.

- **Type:** Chakra Petch for the `NIMBUS PLAY` wordmark, headings and status words;
  Inter for body text, instructions, form fields and errors. No pixel font.
- **Palette:** base `#0F1419` (near-black, not pure black, which halates on OLED),
  panels a step lighter, cyan for primary actions, magenta sparingly for the wordmark
  and destructive actions, amber for warnings, `#E5E7EB` body text.
- **Neon is for interactive elements only:** buttons, active states, status. Surfaces
  and text stay neutral.
- **Shapes:** large rounded cards, full-width buttons, console-like rather than 8-bit.
- **Readability:** body text 16px with 1.5 line height; status words may be uppercase
  and tracked, never long sentences.
- **Mobile first:** single column, tap targets at least 44px tall; on desktop the same
  column, centred, max ~420px.

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
  src/index.css           Tailwind directives + font imports + @theme tokens
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
