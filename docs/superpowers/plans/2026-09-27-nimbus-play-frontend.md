# Nimbus Play Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first Nimbus Play web app, served by the existing backend, that lets a user sign up, start their cloud gaming VM, and tap one button to open Artemis already paired.

**Architecture:** React + Vite + TypeScript + Tailwind, built to static files that Fastify serves from `web/dist` at `/`. Same origin as the API, so no CORS and no mixed content. Auth moves from a bearer token in JS to an httpOnly `session` cookie; the `Authorization` header keeps working for scripts.

**Tech Stack:** Fastify 4 (`@fastify/cookie` ^9, `@fastify/static` ^7), React 18, Vite 5, TypeScript 5, Tailwind CSS 4 (`@tailwindcss/vite`), Vitest + @testing-library/react.

**Spec:** `docs/specs/2026-09-27-nimbus-play-frontend-design.md`

## Global Constraints

- Backend is Fastify 4 — use `@fastify/cookie` ^9 and `@fastify/static` ^7 (v10+/v8+ require Fastify 5).
- Frontend lives in `cloud-gaming/web/`, a separate `package.json`; never add React to the backend's dependencies.
- Tailwind 4 is CSS-first: theme tokens live in `src/index.css` under `@theme`, there is no `tailwind.config.js`. This supersedes the spec's file list.
- Brand name is exactly `Nimbus Play`. Artemis download link is exactly `https://github.com/Swanand01/moonlight-android/releases/latest`.
- Fonts: Chakra Petch for the wordmark, headings, buttons and status words; Inter for body text, form fields and errors. No pixel font anywhere.
- Base colour `#0F1419` (near-black, never `#000`); neon accents only on interactive elements.
- Session cookie: name `session`, `httpOnly`, `sameSite: 'lax'`, `path: '/'`, `secure` only when `COOKIE_SECURE=true`.
- `AUTH_TOKEN_TTL_SECONDS` default becomes `604800` (7 days).
- Every fetch from the frontend sends `credentials: 'include'`; the frontend never stores a token.
- Tap targets at least 44px tall; layout works at 360px wide with no horizontal scroll.
- Do not touch `src/providers/aws.ts` or the Terraform in this plan.

## Review Focus

1. **Logout on a shared phone** — after `POST /auth/logout`, a later API call must be rejected (401), not silently accepted from a stale cookie. Covered in Task 1.
2. **A ready VM that died outside the app** — `/sessions/current` returns `stopped` while the UI shows `ready`; polling must move the UI back to idle rather than leaving a dead Connect button. Covered in Task 5.
3. **Pairing link tapped after it expired** — the 3-minute window closes while the user reads instructions; a stale link must produce a retryable error, not a silent no-op. Covered in Task 6.
4. **Backend unreachable mid-poll** — a dropped mobile connection must not wipe the session state or spin forever; the UI keeps its state and shows a retry. Covered in Task 5.
5. **Static files shadowing the API** — a request to `/health` or `/auth/login` must hit the API, never `index.html`, and an unknown path must return the app (so a refresh works). Covered in Task 2.

---

### Task 1: Session cookie auth

**Files:**
- Modify: `package.json` (add `@fastify/cookie`)
- Modify: `src/auth.ts:78-92` (`getAuthenticatedUserId`)
- Modify: `src/server.ts` (register plugin, set/clear cookie in auth routes)
- Modify: `src/config.ts` (TTL default, `COOKIE_SECURE`)
- Test: `scripts/api-test.sh` (new "Cookie session" section)

**Interfaces:**
- Consumes: `createToken(userId: string): string`, `getAuthenticatedUserId(request: FastifyRequest): Promise<string>` (both exist).
- Produces: `POST /auth/logout` → `204` and `Set-Cookie: session=; Max-Age=0`. `/auth/register` and `/auth/login` keep returning `{ userId, token }` and additionally set the cookie. `getAuthenticatedUserId` accepts the header first, then `request.cookies.session`.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/api-test.sh`, immediately before the `# ---- VM checks` line:

```bash
section "Cookie session"
COOKIE_JAR=$(mktemp)
CODE=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" -X POST "$BASE_URL/auth/login" \
  -H 'content-type: application/json' -d "{\"email\":\"$USER_A\",\"password\":\"$PW\"}")
[ "$CODE" = 200 ] && ok "login succeeds" || bad "login succeeds" "HTTP $CODE"
grep -qi 'session' "$COOKIE_JAR" && ok "login sets a session cookie" || bad "login sets a session cookie" "$(cat "$COOKIE_JAR")"
grep -qi '^#HttpOnly_' "$COOKIE_JAR" && ok "session cookie is httpOnly" || bad "session cookie is httpOnly" "$(cat "$COOKIE_JAR")"
CODE=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$BASE_URL/me")
[ "$CODE" = 200 ] && ok "cookie alone authenticates /me" || bad "cookie alone authenticates /me" "HTTP $CODE"
CODE=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$BASE_URL/auth/logout")
[ "$CODE" = 204 ] && ok "logout returns 204" || bad "logout returns 204" "HTTP $CODE"
CODE=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$BASE_URL/me")
[ "$CODE" = 401 ] && ok "cookie is rejected after logout" || bad "cookie is rejected after logout" "HTTP $CODE"
rm -f "$COOKIE_JAR"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `scripts/api-test.sh 2>&1 | sed -n '/Cookie session/,/^$/p'`
Expected: FAIL on "login sets a session cookie" and "logout returns 204" (no cookie, no route).

- [ ] **Step 3: Install the plugin**

```bash
npm install @fastify/cookie@^9
```

- [ ] **Step 4: Accept the cookie in the auth check**

In `src/auth.ts`, replace the first three lines of `getAuthenticatedUserId`:

```ts
export async function getAuthenticatedUserId(request: FastifyRequest): Promise<string> {
  const authHeader = request.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
  // The browser app sends an httpOnly cookie; scripts and future mobile clients send the header.
  const token = headerToken ?? request.cookies?.session;
  if (!token) {
    throw new Error('Missing bearer token');
  }
```

- [ ] **Step 5: Set and clear the cookie**

In `src/config.ts`, change the TTL default and add the flag:

```ts
    tokenTtlSeconds: numberFromEnv('AUTH_TOKEN_TTL_SECONDS', 60 * 60 * 24 * 7),
    cookieSecure: process.env.COOKIE_SECURE === 'true'
```

In `src/server.ts`, after `const app = Fastify({ logger: true });` and before the error handler:

```ts
app.register(cookie);

const SESSION_COOKIE = 'session';

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: config.auth.cookieSecure,
    maxAge: config.auth.tokenTtlSeconds
  });
}
```

Imports at the top of `src/server.ts`:

```ts
import cookie from '@fastify/cookie';
import Fastify, { type FastifyReply } from 'fastify';
```

In `/auth/register`, replace the final `return { userId: email, token: createToken(email) };`:

```ts
  const token = createToken(email);
  setSessionCookie(reply, token);
  return { userId: email, token };
```

Apply the same two lines to the `return` in `/auth/login`, then add the logout route directly after it:

```ts
app.post('/auth/logout', async (_request, reply) => {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return reply.code(204).send();
});
```

- [ ] **Step 6: Typecheck, deploy, run the tests**

```bash
npm run typecheck
infra/scripts/deploy-backend.sh
scripts/api-test.sh
```
Expected: typecheck clean, deploy `Status: Success`, all checks pass including the six new cookie ones.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/auth.ts src/server.ts src/config.ts scripts/api-test.sh
git commit -m "Authenticate with an httpOnly session cookie as well as the bearer header"
```

---

### Task 2: Serve the frontend from the backend

**Files:**
- Modify: `package.json` (add `@fastify/static`)
- Modify: `src/server.ts` (register static after all routes)
- Modify: `infra/scripts/deploy-backend.sh` (build `web/` on the host)
- Modify: `.gitignore` (`web/dist`, `web/node_modules`)
- Create: `web/dist/index.html` (placeholder for this task only; Task 3 replaces it with a real build)
- Test: `scripts/api-test.sh` ("Static frontend" section)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `GET /` returns `index.html`; unknown paths return `index.html`; every API route keeps its current behavior.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/api-test.sh` after the "Cookie session" section:

```bash
section "Static frontend"
CODE=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$BASE_URL/")
[ "$CODE" = 200 ] && ok "GET / serves the app" || bad "GET / serves the app" "HTTP $CODE"
printf '%s' "$(curl -sS -m 20 "$BASE_URL/")" | grep -qi 'nimbus play' && ok "index.html mentions Nimbus Play" || bad "index.html mentions Nimbus Play"
CODE=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$BASE_URL/some/deep/link")
[ "$CODE" = 200 ] && ok "unknown paths serve the app (refresh works)" || bad "unknown paths serve the app" "HTTP $CODE"
BODY=$(curl -sS -m 20 "$BASE_URL/health")
printf '%s' "$BODY" | grep -q '"ok":true' && ok "API routes are not shadowed by static files" || bad "API routes are not shadowed" "$BODY"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `scripts/api-test.sh 2>&1 | sed -n '/Static frontend/,/^$/p'`
Expected: FAIL on `GET /` with HTTP 404.

- [ ] **Step 3: Install the plugin and add a placeholder page**

```bash
npm install @fastify/static@^7
mkdir -p web/dist
printf '<!doctype html><title>Nimbus Play</title><h1>Nimbus Play</h1>\n' > web/dist/index.html
printf 'web/node_modules\nweb/dist\n' >> .gitignore
```

- [ ] **Step 4: Serve the built app**

At the top of `src/server.ts`:

```ts
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
```

In `main()`, before `await app.listen(...)`:

```ts
  // Registered after every API route so it can never shadow one; unknown paths fall
  // back to index.html so a refresh inside the app works.
  const webRoot = join(__dirname, '..', 'web', 'dist');
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn({ webRoot }, 'no built frontend found; serving API only');
  }
```

Add `import { existsSync } from 'node:fs';` to the imports.

- [ ] **Step 5: Build the frontend during deploys**

In `infra/scripts/deploy-backend.sh`, inside the remote script, after `npm run build`:

```bash
if [ -f web/package.json ]; then (cd web && npm ci --no-audit --no-fund && npm run build); fi
```

- [ ] **Step 6: Deploy and run the tests**

```bash
npm run typecheck
git add -A && git commit -m "Serve the built frontend from the backend"
infra/scripts/deploy-backend.sh
scripts/api-test.sh
```
Expected: all checks pass, including the four new static ones.

---

### Task 3: Frontend scaffold, theme and API client

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`
- Create: `web/src/main.tsx`, `web/src/index.css`, `web/src/api.ts`
- Test: `web/src/api.test.ts`

**Interfaces:**
- Produces:
  - `api.register(email: string, password: string): Promise<void>`
  - `api.login(email: string, password: string): Promise<void>`
  - `api.logout(): Promise<void>`
  - `api.me(): Promise<{ id: string }>`
  - `api.currentSession(): Promise<Session | null>` (null on 404)
  - `api.startSession(): Promise<Session>`
  - `api.stopSession(): Promise<Session>`
  - `api.pairingLink(name: string): Promise<{ link: string; pin: string; passphrase: string; expiresInSeconds: number }>`
  - `type Session = { id: string; status: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'; publicIp?: string; error?: string }`
  - `class ApiError extends Error { status: number }`

- [ ] **Step 1: Scaffold the project**

```bash
cd web
npm init -y
npm install react@^18 react-dom@^18
npm install -D vite@^5 @vitejs/plugin-react@^4 typescript@^5 @types/react @types/react-dom \
  tailwindcss@^4 @tailwindcss/vite@^4 vitest@^2 @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^25
```

`web/vite.config.ts` (the triple-slash reference is required, or TypeScript rejects the `test` key):

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The backend serves the API on the same origin, so dev proxies straight to it.
  server: { proxy: { '/auth': 'http://127.0.0.1:8080', '/sessions': 'http://127.0.0.1:8080', '/pairing': 'http://127.0.0.1:8080', '/me': 'http://127.0.0.1:8080' } },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test-setup.ts' }
});
```

`web/package.json` scripts:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  }
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`web/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0a0a12" />
    <title>Nimbus Play</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/index.css`:

```css
@import "tailwindcss";

@theme {
  --color-void: #0f1419;
  --color-panel: #171d24;
  --color-neon: #22d3ee;
  --color-magenta: #f472b6;
  --color-amber: #fbbf24;
  --font-display: "Chakra Petch", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
}

body {
  background-color: var(--color-void);
  color: #e5e7eb;
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.5;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 2: Write the failing API client test**

`web/src/api.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { api, ApiError } from './api';

function mockFetch(status: number, body: unknown, ok = status < 400) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  });
}

describe('api', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends cookies and never stores a token', async () => {
    const fetchMock = mockFetch(200, { userId: 'a@b.test', token: 'secret-token' });
    vi.stubGlobal('fetch', fetchMock);

    await api.login('a@b.test', 'password123');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect(JSON.stringify(localStorage)).not.toContain('secret-token');
  });

  it('returns null when the user has no session', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { error: 'No active session' }));
    await expect(api.currentSession()).resolves.toBeNull();
  });

  it('throws ApiError with the status and server message', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { error: 'VM is not ready for pairing' }));
    await expect(api.pairingLink('Artemis')).rejects.toMatchObject({
      status: 409,
      message: 'VM is not ready for pairing'
    });
    await expect(api.pairingLink('Artemis')).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && npm test`
Expected: FAIL — `./api` does not exist.

- [ ] **Step 4: Write the API client**

`web/src/api.ts`:

```ts
export type SessionStatus = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export type Session = {
  id: string;
  status: SessionStatus;
  publicIp?: string;
  error?: string;
};

export type PairingLink = {
  link: string;
  pin: string;
  passphrase: string;
  expiresInSeconds: number;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, (body as { error?: string }).error ?? `Request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<void>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<void>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ id: string }>('/me'),
  currentSession: async (): Promise<Session | null> => {
    try {
      return await request<Session>('/sessions/current');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },
  startSession: () => request<Session>('/sessions/start', { method: 'POST', body: '{}' }),
  stopSession: () => request<Session>('/sessions/stop', { method: 'POST' }),
  pairingLink: (name: string) =>
    request<PairingLink>('/pairing/link', { method: 'POST', body: JSON.stringify({ name }) })
};
```

- [ ] **Step 5: Run the tests**

Run: `cd web && npm test`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web .gitignore
git commit -m "Scaffold the Nimbus Play frontend with its API client"
```

---

### Task 4: Shared retro components

**Files:**
- Create: `web/src/components/Button.tsx`, `web/src/components/Panel.tsx`, `web/src/components/StatusLine.tsx`
- Test: `web/src/components/Button.test.tsx`

**Interfaces:**
- Produces:
  - `<Button variant?: 'primary' | 'danger' | 'ghost'; disabled?: boolean; onClick?: () => void>` — renders a `<button>`, min height 44px.
  - `<Panel title?: string>` — bordered container.
  - `<StatusLine text: string; tone?: 'neon' | 'amber' | 'magenta'>` — pixel font, blinking cursor.

- [ ] **Step 1: Write the failing test**

`web/src/components/Button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('is a real button with an accessible name', () => {
    render(<Button onClick={() => {}}>START GAMING</Button>);
    expect(screen.getByRole('button', { name: 'START GAMING' })).toBeInTheDocument();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>START GAMING</Button>);
    screen.getByRole('button').click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npm test -- Button`
Expected: FAIL — `./Button` does not exist.

- [ ] **Step 3: Write the components**

`web/src/components/Button.tsx`:

```tsx
import type { ReactNode } from 'react';

const VARIANTS = {
  primary: 'bg-neon text-void hover:brightness-110',
  danger: 'bg-transparent text-magenta border border-magenta/60',
  ghost: 'bg-transparent text-neon underline'
} as const;

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button'
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof VARIANTS;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`font-display font-semibold text-sm uppercase tracking-wider w-full min-h-11 px-4 py-3 rounded-xl transition active:scale-[0.99] disabled:opacity-40 ${VARIANTS[variant]}`}
    >
      {children}
    </button>
  );
}
```

`web/src/components/Panel.tsx`:

```tsx
import type { ReactNode } from 'react';

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="bg-panel rounded-2xl border border-white/5 p-5 mb-4">
      {title && <h2 className="font-display text-xs uppercase tracking-widest text-neon mb-3">{title}</h2>}
      {children}
    </section>
  );
}
```

`web/src/components/StatusLine.tsx`:

```tsx
const TONES = { neon: 'text-neon', amber: 'text-amber', magenta: 'text-magenta' } as const;

export function StatusLine({ text, tone = 'neon' }: { text: string; tone?: keyof typeof TONES }) {
  return (
    <p className={`font-display text-sm uppercase tracking-widest ${TONES[tone]}`} role="status">
      {text}
    </p>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npm test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components
git commit -m "Add the retro button, panel and status components"
```

---

### Task 5: App shell, auth screen and session polling

**Files:**
- Create: `web/src/App.tsx`, `web/src/AuthScreen.tsx`, `web/src/usePolling.ts`
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3 and 4.
- Produces: `<App />` as the only export of `App.tsx`; `usePolling(callback: () => void, intervalMs: number | null)` runs `callback` on that interval and stops when `intervalMs` is null.

- [ ] **Step 1: Write the failing tests**

`web/src/App.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { api, ApiError } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, api: { ...actual.api, me: vi.fn(), currentSession: vi.fn(), startSession: vi.fn(), stopSession: vi.fn(), logout: vi.fn(), pairingLink: vi.fn() } };
});

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('App', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the login screen when signed out', async () => {
    mocked.me.mockRejectedValue(new ApiError(401, 'Unauthorized'));
    render(<App />);
    expect(await screen.findByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('shows START GAMING when signed in with no session', async () => {
    mocked.me.mockResolvedValue({ id: 'a@b.test' });
    mocked.currentSession.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByRole('button', { name: /start gaming/i })).toBeInTheDocument();
  });

  it('moves back to idle when a ready VM turns out to be stopped', async () => {
    mocked.me.mockResolvedValue({ id: 'a@b.test' });
    mocked.currentSession
      .mockResolvedValueOnce({ id: 's1', status: 'ready', publicIp: '1.2.3.4' })
      .mockResolvedValue({ id: 's1', status: 'stopped' });
    render(<App />);
    expect(await screen.findByRole('button', { name: /connect/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /start gaming/i })).toBeInTheDocument(), { timeout: 8000 });
  });

  it('keeps the session state when the network drops mid-poll', async () => {
    mocked.me.mockResolvedValue({ id: 'a@b.test' });
    mocked.currentSession
      .mockResolvedValueOnce({ id: 's1', status: 'starting' })
      .mockRejectedValue(new ApiError(0, "Couldn't reach the server"));
    render(<App />);
    expect(await screen.findByText(/booting/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument(), { timeout: 8000 });
    expect(screen.getByText(/booting/i)).toBeInTheDocument();
  });

  it('shows the backend error for a failed session', async () => {
    mocked.me.mockResolvedValue({ id: 'a@b.test' });
    mocked.currentSession.mockResolvedValue({ id: 's1', status: 'failed', error: 'Apollo did not become reachable' });
    render(<App />);
    expect(await screen.findByText(/apollo did not become reachable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npm test -- App`
Expected: FAIL — `./App` does not exist.

- [ ] **Step 3: Write the polling hook**

`web/src/usePolling.ts`:

```ts
import { useEffect, useRef } from 'react';

// Runs callback every intervalMs; pass null to stop. The ref keeps the latest
// callback without restarting the timer on every render.
export function usePolling(callback: () => void, intervalMs: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (intervalMs === null) {
      return;
    }
    const id = setInterval(() => saved.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
```

- [ ] **Step 4: Write the auth screen**

`web/src/AuthScreen.tsx`:

```tsx
import { useState } from 'react';
import { api, ApiError } from './api';
import { Button } from './components/Button';
import { Panel } from './components/Panel';

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === 'login' ? api.login(email, password) : api.register(email, password));
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={mode === 'login' ? 'LOG IN' : 'SIGN UP'}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full min-h-11 bg-void rounded-xl border border-white/10 px-3 text-base focus:border-neon outline-none"
          />
        </label>
        <label className="text-sm">
          Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full min-h-11 bg-void rounded-xl border border-white/10 px-3 text-base focus:border-neon outline-none"
          />
        </label>
        {error && <p className="text-sm text-amber">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? 'PLEASE WAIT' : mode === 'login' ? 'LOG IN' : 'SIGN UP'}
        </Button>
        <Button variant="ghost" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
        </Button>
      </form>
    </Panel>
  );
}
```

- [ ] **Step 5: Write the app shell**

`web/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Session } from './api';
import { AuthScreen } from './AuthScreen';
import { Button } from './components/Button';
import { Panel } from './components/Panel';
import { StatusLine } from './components/StatusLine';
import { usePolling } from './usePolling';

type Auth = 'unknown' | 'signed-out' | 'signed-in';

const STATUS_TEXT: Record<Session['status'], string> = {
  starting: 'BOOTING…',
  ready: 'READY — PRESS CONNECT',
  stopping: 'SHUTTING DOWN…',
  stopped: 'PLAYER 1 READY',
  failed: 'GAME OVER'
};

export function App() {
  const [auth, setAuth] = useState<Auth>('unknown');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const current = await api.currentSession();
      setSession(current);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuth('signed-out');
        return;
      }
      // Keep whatever state we had: a dropped mobile connection shouldn't reset the UI.
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }, []);

  useEffect(() => {
    api.me().then(() => setAuth('signed-in')).catch(() => setAuth('signed-out'));
  }, []);

  useEffect(() => {
    if (auth === 'signed-in') {
      void refresh();
    }
  }, [auth, refresh]);

  const status = session?.status ?? 'stopped';
  const isBusy = status === 'starting' || status === 'stopping';
  usePolling(() => void refresh(), auth === 'signed-in' && isBusy ? 5000 : null);

  async function act(action: () => Promise<Session>) {
    setError(null);
    try {
      setSession(await action());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  if (auth === 'unknown') {
    return <Shell><StatusLine text="LOADING" /></Shell>;
  }

  if (auth === 'signed-out') {
    return (
      <Shell>
        <AuthScreen onSignedIn={() => setAuth('signed-in')} />
        <Instructions />
      </Shell>
    );
  }

  return (
    <Shell>
      <Panel>
        <StatusLine text={STATUS_TEXT[status]} tone={status === 'failed' ? 'amber' : 'neon'} />
        {status === 'failed' && session?.error && <p className="mt-3 text-sm">{session.error}</p>}
        {status === 'starting' && (
          <p className="mt-3 text-sm">Your PC is booting. The first start takes a few minutes.</p>
        )}
        <div className="mt-4 flex flex-col gap-3">
          {(status === 'stopped' || status === 'failed') && (
            <Button onClick={() => void act(api.startSession)}>
              {status === 'failed' ? 'TRY AGAIN' : 'START GAMING'}
            </Button>
          )}
          {status === 'ready' && <ConnectButton />}
          {(status === 'ready' || status === 'starting') && (
            <Button variant="danger" onClick={() => void act(api.stopSession)}>STOP</Button>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-amber">{error}</p>}
      </Panel>
      {status !== 'ready' && <Instructions />}
      <Button variant="ghost" onClick={() => void api.logout().then(() => { setSession(null); setAuth('signed-out'); })}>
        Log out
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh px-4 py-8">
      <div className="mx-auto w-full max-w-[420px]">
        <h1 className="font-display text-2xl font-bold tracking-tight text-neon mb-1">NIMBUS<span className="text-magenta"> PLAY</span></h1>
        <p className="text-xs text-gray-400 mb-6">Your gaming PC, in the cloud.</p>
        {children}
      </div>
    </main>
  );
}
```

`ConnectButton` and `Instructions` are added in Task 6; for this task, add temporary stubs at the bottom of `App.tsx` so the tests compile:

```tsx
function ConnectButton() {
  return <Button>CONNECT</Button>;
}

function Instructions() {
  return null;
}
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npm test`
Expected: PASS (10 tests).

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "Add the Nimbus Play app shell, auth screen and session polling"
```

---

### Task 6: Connect button and instructions

**Files:**
- Create: `web/src/ConnectButton.tsx`, `web/src/components/Instructions.tsx`
- Modify: `web/src/App.tsx` (import the real components, delete the stubs)
- Test: `web/src/ConnectButton.test.tsx`

**Interfaces:**
- Consumes: `api.pairingLink`, `Button`, `Panel` from earlier tasks.
- Produces: `<ConnectButton />` and `<Instructions />`, both default-free named exports.

- [ ] **Step 1: Write the failing tests**

`web/src/ConnectButton.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectButton } from './ConnectButton';
import { api, ApiError } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, api: { ...actual.api, pairingLink: vi.fn() } };
});

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('ConnectButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the link only when tapped, then opens it', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    mocked.pairingLink.mockResolvedValue({ link: 'art://1.2.3.4:47989?pin=1234&passphrase=abcd1234&name=PC', pin: '1234', passphrase: 'abcd1234', expiresInSeconds: 180 });

    render(<ConnectButton />);
    expect(mocked.pairingLink).not.toHaveBeenCalled();

    screen.getByRole('button', { name: /connect/i }).click();

    await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining('art://')));
    expect(await screen.findByText('1234')).toBeInTheDocument();
    expect(screen.getByText('abcd1234')).toBeInTheDocument();
  });

  it('offers a retry when the link has expired or the VM is not ready', async () => {
    mocked.pairingLink.mockRejectedValue(new ApiError(409, 'VM is not ready for pairing'));
    render(<ConnectButton />);
    screen.getByRole('button', { name: /connect/i }).click();
    expect(await screen.findByText(/vm is not ready for pairing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect/i })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npm test -- ConnectButton`
Expected: FAIL — `./ConnectButton` does not exist.

- [ ] **Step 3: Write the components**

`web/src/ConnectButton.tsx`:

```tsx
import { useState } from 'react';
import { api, ApiError, type PairingLink } from './api';
import { Button } from './components/Button';

export function ConnectButton() {
  const [pairing, setPairing] = useState<PairingLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      // Fetched on tap, not on render: the code is only valid for ~3 minutes.
      const link = await api.pairingLink('Artemis');
      setPairing(link);
      location.assign(link.link);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => void connect()} disabled={busy}>
        {busy ? 'OPENING…' : 'CONNECT'}
      </Button>
      {error && <p className="text-sm text-amber">{error}</p>}
      {pairing && (
        <div className="text-sm text-gray-300">
          <p>If Artemis didn't open, add the PC manually and pair with:</p>
          <p className="mt-1">
            PIN <span className="font-display font-bold text-neon">{pairing.pin}</span> · passphrase{' '}
            <span className="font-display font-bold text-neon">{pairing.passphrase}</span>
          </p>
          <p className="mt-1 text-xs text-gray-400">Expires in {Math.round(pairing.expiresInSeconds / 60)} minutes. Press CONNECT again for a new code.</p>
        </div>
      )}
    </div>
  );
}
```

`web/src/components/Instructions.tsx`:

```tsx
import { Panel } from './Panel';

const RELEASE_URL = 'https://github.com/Swanand01/moonlight-android/releases/latest';

export function Instructions() {
  return (
    <Panel title="HOW TO PLAY">
      <ol className="list-decimal pl-5 text-sm space-y-2">
        <li>
          Install the Artemis app once:{' '}
          <a className="text-neon underline" href={RELEASE_URL} target="_blank" rel="noreferrer">
            download the APK
          </a>
          , open it, and allow installs from your browser when asked.
        </li>
        <li>Press START GAMING and wait until it says READY. The first start takes a few minutes.</li>
        <li>Press CONNECT. Artemis opens and pairs with your PC by itself.</li>
        <li>Press STOP when you're finished, so your PC isn't left running.</li>
      </ol>
    </Panel>
  );
}
```

- [ ] **Step 4: Use them in the app**

In `web/src/App.tsx`, delete the two stub functions at the bottom and add:

```tsx
import { ConnectButton } from './ConnectButton';
import { Instructions } from './components/Instructions';
```

- [ ] **Step 5: Run the tests and build**

Run: `cd web && npm test && npm run build`
Expected: PASS (12 tests), build writes `web/dist`.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "Add the connect button and how-to-play instructions"
```

---

### Task 7: Deploy and verify on a real device

**Files:**
- Modify: `README.md` (frontend section)
- Modify: `docs/specs/2026-09-27-nimbus-play-frontend-design.md` (note Tailwind 4 uses `@theme`, not `tailwind.config.js`)
- Check on a phone that the wordmark and status words are legible at 360px and that no text sits below 16px.

- [ ] **Step 1: Deploy**

```bash
git push
infra/scripts/deploy-backend.sh
```
Expected: `Status: Success`.

- [ ] **Step 2: Run the full backend test suite**

```bash
scripts/api-test.sh
```
Expected: every check passes, including the cookie and static-frontend sections.

- [ ] **Step 3: Walk the flow in a desktop browser**

Open `http://13.200.213.109:8080`, sign up with a throwaway address, press START GAMING, wait for READY, press CONNECT (the `art://` link won't open anything on desktop, which is expected), then STOP.
Expected: states move idle → BOOTING → READY → PLAYER 1 READY, and the PIN and passphrase appear under CONNECT.

- [ ] **Step 4: Check the phone layout**

In the browser's device toolbar at 360px wide: no horizontal scrolling, every button at least 44px tall, and the instructions readable without zooming.

- [ ] **Step 5: Hand to the user for the device check**

Ask the user to open the site on their Android phone, install Artemis from the instructions link, and press CONNECT with a ready VM.
Expected: Artemis opens, adds the PC and pairs without a PIN prompt.

- [ ] **Step 6: Clean up test users and commit**

```bash
scripts/api-test.sh --cleanup
git add README.md docs/specs/2026-09-27-nimbus-play-frontend-design.md
git commit -m "Document the Nimbus Play frontend"
git push
```
