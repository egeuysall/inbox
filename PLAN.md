You are building a personal, offline‑first, AI‑powered **thought inbox → todo generator** as a PWA for a single user (Ege). The app is internal, but deployed on the public web, and must be fast, minimal, and reliable. The setup and pnpm packages are already complete, use shadcn for the design

## High‑level product

- Purpose: Ege types messy thoughts (even offline).
- The app stores them locally immediately, syncs them to a backend when online, then uses AI (via Vercel AI Gateway) to convert them into structured todos.
- The UI is **ultra minimal, dev‑like**, inspired by egeuysal.com: lots of whitespace, single column, clean mono/neutral font, clear sections, and a simple light/dark mode toggle. [culturedcode](https://culturedcode.com/things/help/url-scheme/)
- Only Ege should effectively be able to use it, with a simple “one private password remembered on this device” experience.

Name the app “MG – My Goat” only in code comments and title tags; in the UI, just show “Inbox” and “Todos”.

---

## Stack and architecture

- Framework: **Next.js (App Router)** with TypeScript.
- Styling: **Tailwind CSS**, with a minimal theme (similar spacing/typography feel to egeuysal.com). [culturedcode](https://culturedcode.com/things/help/url-scheme/)
- Backend:
  - Option A (preferred): **Convex** for realtime data and auth. [convex](https://www.convex.dev)
  - Option B (if Convex not available): Next.js API routes with PostgreSQL.
- AI: **Vercel AI Gateway** as the single endpoint for calling an LLM to turn text into todos. [vercel](https://vercel.com/docs/ai-gateway/capabilities)
- PWA: Installable app with offline shell and IndexedDB storage for local queue. [blog.logrocket](https://blog.logrocket.com/nextjs-16-pwa-offline-support/)

Assume the environment already has necessary keys and Convex / DB configured; focus on schema, logic, and UI.

---

## Data model

Design a minimal schema that supports:

1. **Thoughts** (raw capture)
   - `id` (string, UUID)
   - `rawText` (string)
   - `createdAt` (timestamp)
   - `status` (`"pending" | "processing" | "done" | "failed"`)
   - `synced` (boolean)
   - `aiRunId` (string | null)

2. **Todos**
   - `id` (string, UUID)
   - `thoughtId` (string, FK to Thought)
   - `title` (string)
   - `notes` (string | null)
   - `status` (`"open" | "done"`)
   - `createdAt` (timestamp)

3. **Sessions / user**
   - Single logical user (Ege).
   - Backend must still identify the caller via a **session cookie** (see Security section).

In Convex, mirror this as `thoughts`, `todos`, and `sessions` tables; in Postgres, as normal tables.

---

## Offline and sync behavior

Goal: **near‑instant UX even offline**.

- Use **IndexedDB** in the browser to store a local queue of thoughts. [stackoverflow](https://stackoverflow.com/questions/77866890/storing-data-in-indexdb-when-application-is-in-offline-pwa-service-worker)
- Schema in IndexedDB: `localThoughts` with the same fields as above plus `syncStatus` (`"local-only" | "syncing" | "synced" | "error"`).
- On submit:
  - Always create a local record first (ID, text, timestamps, `syncStatus="local-only"`).
  - Optimistically render it in the **Inbox** list immediately.
- Sync engine:
  - Detect online/offline via `window.navigator.onLine` and `online/offline` events.
  - When online, periodically (and on app focus) push `local-only` thoughts to the backend.
  - After backend acknowledges, mark them as `synced` locally and update with server IDs if needed. [blog.logrocket](https://blog.logrocket.com/nextjs-16-pwa-offline-support/)
- When offline:
  - Disable “Run AI” actions with a tooltip like “AI requires connection – your thoughts are saved locally.”
  - Keep all captured thoughts visible.

---

## AI pipeline (Vercel AI Gateway)

- When a thought is **synced** and user clicks “Generate todos” (or automatic if you decide), call Vercel AI Gateway with a deterministic prompt.

Prompt requirements:

- Input: `rawText` of the thought (may contain multiple ideas).
- Output: strict JSON array of todos:

```json
[
  {
    "title": "Short actionable title",
    "notes": "Optional extra context or steps"
  }
]
```

- Handle the case where there are no actionable todos (return empty array).

Implementation details:

- Use streaming if convenient, but final result must be parsed into JSON safely.
- On success:
  - Create `Todo` records linked to the `Thought`.
  - Set thought `status="done"`.
- On failure:
  - Set `status="failed"` and show a subtle error indicator.

Use Vercel AI Gateway as an upstream for the model; assume one configured “default” model. [vercel](https://vercel.com/docs/ai-gateway/capabilities)

---

## Security model (“one password remembered on this device”)

You must design a **simple login gate** that protects the app from random visitors, while letting Ege stay signed in.

- On first visit:
  - Show a very minimal full‑screen login:
    - Title: “Enter access key”
    - Single password field.
  - On submit, POST to a `/api/login` route.
- `/api/login`:
  - Compare password with a **single env var** (e.g., `APP_ACCESS_PASSWORD`).
  - If correct, create a signed session token (e.g., random UUID) and:
    - Store a hash of it in a `sessions` table or Convex function.
    - Send it to the client as an **HttpOnly, Secure, SameSite=Lax cookie** with a long expiration (e.g., 90 days). [troyhunt](https://www.troyhunt.com/how-to-build-and-how-not-to-build/)
  - If incorrect, return 401.
- Every protected server action / Convex function must:
  - Read the cookie.
  - Validate token exists and is not expired. [docs.convex](https://docs.convex.dev/auth/functions-auth)
  - If invalid, return 401 so the frontend can redirect back to login.

Important:

- Never store the raw password in localStorage or cookies. [stackoverflow](https://stackoverflow.com/questions/15454634/the-most-secure-way-of-setting-up-a-cookie-for-a-remember-me-feature)
- Only store the random session token, and only in HttpOnly cookies so JS can’t read it.
- Provide a simple “Sign out” button in settings that clears the cookie and local IndexedDB.

You can also optionally add a short **PIN or passphrase** layer purely client‑side, but the core security must be server‑validated.

---

## UI / UX requirements

Design goals: **developer‑like, minimal, high information density**, similar to egeuysal.com but adapted for an app. [culturedcode](https://culturedcode.com/things/help/url-scheme/)

General:

- Two main panels on desktop, single column stacked on mobile:
  - Left/top: **Inbox** (thoughts).
  - Right/bottom: **Todos** for the selected thought.
- Top bar:
  - App name (simple text, e.g., “Inbox”).
  - Light/Dark mode toggle (system default, with manual override stored in localStorage).
  - Very small “Settings” icon or text link (for sign out, maybe debug info).
- Typography:
  - Use a neutral sans (e.g., Inter / system) and optionally a mono font for metadata.
- Colors:
  - Light mode: off‑white background, soft gray borders, black text.
  - Dark mode: near‑black background, soft gray text, muted accent.
- Animations:
  - Micro transitions only (fade/slide 100–150ms), no heavy motion.

Components:

1. **Thought composer**
   - Big textarea at the top: “Dump your thoughts…”
   - Underneath:
     - “Save” button (primary).
     - “Save & run AI” button (secondary, disabled offline).
   - Show character count subtly.

2. **Inbox list**
   - List of thoughts, newest first.
   - Each item shows:
     - First line of text.
     - Small timestamp.
     - Status badge: `Saved locally`, `Syncing`, `Synced`, `AI done`, `AI failed`.
   - Clicking an item selects it and shows its todos.

3. **Todos panel**
   - Header: “Todos from this thought”.
   - List of todos with:
     - Checkbox for done.
     - Title in one line.
     - Expandable notes (if any).
   - Ability to:
     - Manually add a todo under a thought.
     - Mark as done/undo.

4. **Status indicators**
   - In footer or small status line:
     - Connection status: `Online` / `Offline` with subtle dot.
     - Sync status: `All synced` / `Syncing…` / `Local only`.

5. **Responsive**
   - On iPhone‑sized screens, PWA should look like a single‑screen tool:
     - Composer at top, then Inbox list, then optional Todos below.
   - Ensure everything is easily tappable.

---

## PWA behavior

- Add manifest.json with:
  - Name, short name, icons.
  - `display: "standalone"`.
  - Proper theme/background colors for light/dark.
- Service worker:
  - Cache the **app shell** (HTML, JS, CSS) so the app loads offline. [blog.logrocket](https://blog.logrocket.com/nextjs-16-pwa-offline-support/)
  - Do not over‑cache API responses; focus on making the UI usable and IndexedDB data available.
- Ensure “Add to Home Screen” works on iOS and Chrome.

---

## Realtime behavior

If Convex is used:

- Use Convex realtime queries to reflect:
  - new thoughts synced from other tabs,
  - changes to todos (completion, edits). [docs.convex](https://docs.convex.dev/realtime)
- On the frontend, subscribe to:
  - `useQuery("thoughts:list")`
  - `useQuery("todos:byThought", { thoughtId })`
- Apply optimistic updates for toggling todo completion.

If no Convex:

- Implement a lightweight polling or SSE/WebSocket layer, but this is lower priority since the app is single‑user.

---

## Error handling and resilience

- All network/API errors must:
  - Keep local data intact.
  - Show a small, non‑blocking error toast.
- If AI parsing fails (e.g., invalid JSON), show a message and keep the thought in `failed` state with a “Retry AI” button.
- If sync fails (e.g., server down), keep `syncStatus="error"` and retry periodically.

---

## Implementation notes

- Write clean, typed React components with clear separation:
  - `components/layout/*`
  - `components/thoughts/*`
  - `components/todos/*`
  - `lib/indexedDb.ts`
  - `lib/apiClient.ts`
- Use custom hooks:
  - `useOfflineStatus()`
  - `useThoughts()` to abstract IndexedDB + server syncing.
  - `useTheme()` for light/dark + system preference.

- Comments in code should explain **why** (design choices), not just **what**.

---

## Deliverable

Produce the **full codebase structure** (pages/routes, components, Convex/DB functions, IndexedDB helpers, AI call wrapper) and ensure:

- First run shows the login screen and sets a persistent cookie on success.
- After login, the main app loads, works offline for capture, syncs when online, and can generate todos via AI.
- Design matches the spirit of a minimal dev‑like tool (like egeuysal.com) with both light and dark mode. [culturedcode](https://culturedcode.com/things/help/url-scheme/)

One shot this: the agent should output production‑ready code and configuration consistent with this spec.
