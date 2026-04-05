# ibx

`ibx` is a private, offline-first task execution app for quickly turning raw thoughts into prioritized todos.

- Web app: Next.js 16 + React 19 + shadcn/ui
- Backend/data: Convex
- AI: Vercel AI Gateway
- Auth: password-gated session + API keys (`iak_...`) for CLI/Bearer access
- Extras: installable PWA, generated Apple Shortcut, TypeScript CLI

Deployed URL: [https://ibx.egeuysal.com](https://ibx.egeuysal.com)

## What This Project Does

1. You type one thought in the top input (`> type once, generate todos`).
2. The input is saved to local IndexedDB queue immediately.
3. If online and authenticated, queued prompts are flushed to `/api/todos/generate`.
4. AI returns at most 30 actionable todos with date/priority/recurrence.
5. Todos are persisted in Convex and shown in `today`, `upcoming`, and `archive`.

If offline, prompts stay queued and are sent when connectivity returns.

## Keyboard Shortcuts

- `Cmd/Ctrl + 1` → switch to `today` view
- `Cmd/Ctrl + 2` → switch to `upcoming` view
- `Cmd/Ctrl + 3` → switch to `archive` view
- `Cmd/Ctrl + Shift + K` → focus the prompt input (`> type once, generate todos`)
- `Enter` (inside prompt input) → submit prompt and generate todos
- `Cmd/Ctrl + B` → toggle sidebar

## Moving Parts

### Frontend (Next.js app router)

- Main UI shell: [src/components/layout/app-shell.tsx](/Users/egeuysal/Developer/inbox/src/components/layout/app-shell.tsx)
- Settings: [src/components/layout/settings-view.tsx](/Users/egeuysal/Developer/inbox/src/components/layout/settings-view.tsx)
- Pages:
  - Home: [src/app/page.tsx](/Users/egeuysal/Developer/inbox/src/app/page.tsx)
  - Settings page: [src/app/settings/page.tsx](/Users/egeuysal/Developer/inbox/src/app/settings/page.tsx)
- PWA shell registration:
  - [src/components/layout/sw-register.tsx](/Users/egeuysal/Developer/inbox/src/components/layout/sw-register.tsx)
  - [public/sw.js](/Users/egeuysal/Developer/inbox/public/sw.js)
- Manifest: [src/app/manifest.ts](/Users/egeuysal/Developer/inbox/src/app/manifest.ts)

### Local storage and offline queue

- IndexedDB adapter: [src/lib/indexedDb.ts](/Users/egeuysal/Developer/inbox/src/lib/indexedDb.ts)
- Stores:
  - `localThoughts`
  - `queuedPrompts`
- Queue behavior is integrated in:
  - [src/components/layout/app-shell.tsx](/Users/egeuysal/Developer/inbox/src/components/layout/app-shell.tsx)

### API and auth

- Session/password + Bearer key auth resolver: [src/lib/auth-server.ts](/Users/egeuysal/Developer/inbox/src/lib/auth-server.ts)
- Session internals (hashing + secure cookie options): [src/lib/session.ts](/Users/egeuysal/Developer/inbox/src/lib/session.ts)
- API key generation + hashing: [src/lib/api-keys.ts](/Users/egeuysal/Developer/inbox/src/lib/api-keys.ts)
- API routes: `src/app/api/**`

### AI pipeline and personalization

- AI call + strict todo normalization: [src/lib/ai.ts](/Users/egeuysal/Developer/inbox/src/lib/ai.ts)
- Context hydration from external profile data:
  - [src/lib/ege-context.ts](/Users/egeuysal/Developer/inbox/src/lib/ege-context.ts)
  - Pulls `agents.json`, plus latest 7 diary summaries and latest 7 blog titles.
- Planning and capping generated todos: [src/lib/todo-planning.ts](/Users/egeuysal/Developer/inbox/src/lib/todo-planning.ts)

### Convex backend

- Schema: [convex/schema.ts](/Users/egeuysal/Developer/inbox/convex/schema.ts)
- Domain modules:
  - Thoughts: [convex/thoughts.ts](/Users/egeuysal/Developer/inbox/convex/thoughts.ts)
  - Todos: [convex/todos.ts](/Users/egeuysal/Developer/inbox/convex/todos.ts)
  - Sessions: [convex/sessions.ts](/Users/egeuysal/Developer/inbox/convex/sessions.ts)
  - API keys: [convex/apiKeys.ts](/Users/egeuysal/Developer/inbox/convex/apiKeys.ts)
  - Memories: [convex/memories.ts](/Users/egeuysal/Developer/inbox/convex/memories.ts)

### CLI + installer + Shortcut

- CLI source: [cli/src/index.ts](/Users/egeuysal/Developer/inbox/cli/src/index.ts)
- CLI docs: [cli/README.md](/Users/egeuysal/Developer/inbox/cli/README.md)
- Bundle script for downloadable binary-like JS file: [scripts/build-ibx-bundle.mjs](/Users/egeuysal/Developer/inbox/scripts/build-ibx-bundle.mjs)
- Installer script served publicly: [public/install.sh](/Users/egeuysal/Developer/inbox/public/install.sh)
- Shortcut generator (`@joshfarrant/shortcuts-js`):
  - [shortcut/generate-shortcut.cjs](/Users/egeuysal/Developer/inbox/shortcut/generate-shortcut.cjs)
  - Signed output: [public/shortcuts/ibx-capture.shortcut](/Users/egeuysal/Developer/inbox/public/shortcuts/ibx-capture.shortcut)

## Data Model (Convex)

- `sessions`: hashed session tokens and expiry/last-seen
- `apiKeys`: hashed API keys (`keyHash`), key metadata, revoked timestamp
- `thoughts`: raw thought captures with sync/AI status
- `todos`: generated/manual todos with schedule + recurrence + priority
- `memories`: profile memory + past run summaries used for AI context

## Environment Variables

Copy [.env.example](/Users/egeuysal/Developer/inbox/.env.example) to `.env.local`.

Required keys:

- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_SITE_URL`
- `AI_GATEWAY_API_KEY`
- `AI_AGENT_MODEL` (default: `openai/gpt-5.4-nano`)
- `APP_ACCESS_PASSWORD`
- `NEXT_PUBLIC_SITE_URL` (default deployment URL)

Optional:

- `SESSION_COOKIE_SECURE=false` for local HTTP testing only

## Local Development

Prerequisites:

- Node.js 20+
- pnpm 9+
- Convex project/deployment

Install and run:

```bash
pnpm install
cp .env.example .env.local
pnpm dlx convex dev
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), enter `APP_ACCESS_PASSWORD`, and use the app.

## API Surface

ibx API is available for external integrations using API keys (`iak_...`).

Detailed docs:

- [API Reference](/Users/egeuysal/Developer/inbox/docs/API.md)
- [Authentication Guide](/Users/egeuysal/Developer/inbox/docs/API_AUTH.md)

Auth/session:

- `POST /api/login`
- `POST /api/logout`
- `GET /api/session` (supports cookie auth or Bearer API key)

Thoughts:

- `GET /api/thoughts`
- `POST /api/thoughts/sync`
- `GET /api/thoughts/:externalId/todos`
- `POST /api/thoughts/:externalId/todos`
- `POST /api/thoughts/:externalId/generate`

Todos:

- `GET /api/todos`
- `POST /api/todos/generate`
- `PATCH /api/todos/:todoId`

API keys:

- `GET /api/api-keys` (active only)
- `POST /api/api-keys` (returns raw key once)
- `DELETE /api/api-keys/:keyId` (revokes key)

Bearer usage:

```http
Authorization: Bearer iak_...
```

Integration note:

- Prefer server-to-server usage with Bearer API keys.
- Keep API keys out of browser bundles and public repos.

API curl examples:

```bash
IBX_BASE_URL="https://ibx.egeuysal.com"
IBX_API_KEY="iak_your_key_here"
TODAY_UTC="$(date -u +%F)"
YESTERDAY_UTC="$(date -u -v-1d +%F 2>/dev/null || date -u -d 'yesterday' +%F)"

# fetch today's tasks
curl -sS "$IBX_BASE_URL/api/todos?today=$TODAY_UTC" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json"

# fetch yesterday's tasks
curl -sS "$IBX_BASE_URL/api/todos?today=$YESTERDAY_UTC" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json"

# fetch tasks for a specific date
curl -sS "$IBX_BASE_URL/api/todos?today=2026-04-03" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json"

# generate todos from free text
curl -sS -X POST "$IBX_BASE_URL/api/todos/generate" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Plan next week: finalize landing page, follow up with 8 leads, and schedule gym"}'

# mark a todo as done
curl -sS -X PATCH "$IBX_BASE_URL/api/todos/<todoId>" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'

# delete a todo
curl -sS -X DELETE "$IBX_BASE_URL/api/todos/<todoId>" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json"
```

## CLI (`ibx`)

The CLI is TypeScript-based and uses `flags`.

Install (recommended, no npm publish needed):

```bash
curl -fsSL https://ibx.egeuysal.com/install.sh | bash
```

Auth and basic flow:

```bash
ibx auth login --api-key iak_...
ibx add "finish landing page and email two leads"
ibx todos list --view today
ibx td
```

Available commands:

- `ibx auth login [--api-key iak_...] [--url https://ibx.egeuysal.com]`
- `ibx a l [--api-key iak_...] [--url https://ibx.egeuysal.com]` (short)
- `ibx auth status`
- `ibx a s` (short)
- `ibx auth logout`
- `ibx a o` (short)
- `ibx add [--input "..."]`
- `ibx n [--input "..."]` (short)
- `ibx todos list [--view today|upcoming|archive|all] [--json]`
- `ibx t l [--view today|upcoming|archive|all] [--json]` (short)
- `ibx td` (today's completed tasks)
- `ibx todos done --id <todoId|prefix>`
- `ibx t x --id <todoId|prefix>` (short)
- `ibx todos open --id <todoId|prefix>`
- `ibx t o --id <todoId|prefix>` (short)
- `ibx todos delete --id <todoId|prefix>`
- `ibx t d --id <todoId|prefix>` (short)
- `ibx todos set --id <todoId|prefix> [--title "new title"] [--due YYYY-MM-DD] [--priority 1|2|3] [--recurrence none|daily|weekly|monthly]`
- `ibx t s --id <todoId|prefix> [--title "new title"] [--due YYYY-MM-DD] [--priority 1|2|3] [--recurrence none|daily|weekly|monthly]` (short)

Build CLI artifacts:

```bash
pnpm cli:build
pnpm cli:bundle
```

## Apple Shortcut

Build shortcut file:

```bash
pnpm shortcut:build
```

Import one of:

- local: [shortcut/dist/ibx-capture.shortcut](/Users/egeuysal/Developer/inbox/shortcut/dist/ibx-capture.shortcut)
- hosted signed file: [https://ibx.egeuysal.com/shortcuts/ibx-capture.shortcut](https://ibx.egeuysal.com/shortcuts/ibx-capture.shortcut)

Shortcut behavior:

- asks for text input
- includes `API Key (Edit Once)` text action (`iak_replace_me`) you set once after install
- sends direct API request to `POST /api/todos/generate` when online
- falls back to opening `https://ibx.egeuysal.com/?shortcut=...&source=shortcut` when offline

## Security Notes

- App password is never stored client-side.
- Session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Session tokens are hashed before DB persistence.
- API keys are generated with strong randomness and stored only as SHA-256 hashes.
- Revoked API keys are excluded from active key listing and rejected for auth.

## Common Scripts

From repo root:

- `pnpm dev` → start Next.js dev server
- `pnpm build` → production build
- `pnpm start` → run production build
- `pnpm lint` → ESLint
- `pnpm cli:build` → build CLI TS output
- `pnpm cli:bundle` → build downloadable `public/ibx`
- `pnpm shortcut:build` → generate/copy `.shortcut` file

## Notes

- UI is intentionally minimal and terminal-inspired (pure black/white, Geist Mono).
- Todo generation is intentionally constrained:
  - max 30 new todos per AI run
  - duplicate filtering
  - recurrence/priority normalization
  - due date auto-rescheduling safeguards
