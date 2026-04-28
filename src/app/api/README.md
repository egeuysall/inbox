# ibx API (Bearer Key)

Use your API key (`iak_...`) as a Bearer token:

```bash
Authorization: Bearer iak_xxx...
```

Base URL (production):

```text
https://ibx.egeuysal.com
```

## Quick Start

```bash
export IBX_BASE_URL="https://ibx.egeuysal.com"
export IBX_API_KEY="iak_xxx..."
```

Check auth:

```bash
curl -sS "$IBX_BASE_URL/api/session" \
  -H "Authorization: Bearer $IBX_API_KEY"
```

API key permissions:
- `read` => `GET/HEAD/OPTIONS` only
- `write` => `POST/PATCH/DELETE` only
- `both` => all operations

## Bearer-Key Endpoints

### `POST /api/todos/generate`
AI todo operator from free text.

Body:

```json
{
  "text": "put all upcoming tasks to today and schedule them",
  "today": "2026-04-03"
}
```

- `text` required.
- `today` optional (`YYYY-MM-DD`), used as reference date.

Behavior:
- AI can create new todos.
- AI can update existing todos (title, notes, status, due date, hours, time block, priority, recurrence).
- AI can delete existing todos.
- For safety, updates/deletes are restricted to existing todo IDs in your account snapshot.
- Invalid/non-snapshot mutation IDs are ignored server-side and never executed.
- Delete operations run only when your prompt includes explicit delete intent (for example: "delete/remove/clear").

Example:

```bash
curl -sS -X POST "$IBX_BASE_URL/api/todos/generate" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"put all upcoming tasks to today and schedule them"}'
```

Response fields:
- `created`: number of new todos created.
- `updated`: number of existing todos updated.
- `deleted`: number of existing todos deleted.
- `droppedMutationOps`: number of AI update/delete ops discarded because IDs were not in the snapshot.
- `mode`: `"create"` or `"mutate"`.
- `message`: optional AI status note.

### `GET /api/todos`
List all todos.

Query:
- `today` optional (`YYYY-MM-DD`) for scheduling normalization.

```bash
curl -sS "$IBX_BASE_URL/api/todos?today=2026-04-03" \
  -H "Authorization: Bearer $IBX_API_KEY"
```

### `PATCH /api/todos/:todoId`
Update an existing todo.

Body fields:
- `status`: `"open"` or `"done"`
- `title`: string (required if provided, max 140 chars)
- `notes`: string or `null` (max 4000 chars)
- `dueDate`: `YYYY-MM-DD` or `null`
- `estimatedHours`: number between `0.25` and `24` (quarter-hour increments)
- `timeBlockStart`: unix timestamp in milliseconds or `null`
- `recurrence`: `"none" | "daily" | "weekly" | "monthly"`
- `priority`: `1 | 2 | 3`

```bash
curl -sS -X PATCH "$IBX_BASE_URL/api/todos/<todoId>" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

### `DELETE /api/todos/:todoId`
Delete a todo.

```bash
curl -sS -X DELETE "$IBX_BASE_URL/api/todos/<todoId>" \
  -H "Authorization: Bearer $IBX_API_KEY"
```

### `GET /api/thoughts`
List thought runs.

```bash
curl -sS "$IBX_BASE_URL/api/thoughts" \
  -H "Authorization: Bearer $IBX_API_KEY"
```

### `POST /api/thoughts/sync`
Upsert thought records from a client queue.

```bash
curl -sS -X POST "$IBX_BASE_URL/api/thoughts/sync" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"thoughts":[{"externalId":"<uuid>","rawText":"draft follow-up","createdAt":1712443200000,"status":"pending","aiRunId":null}]}'
```

### `GET /api/thoughts/:externalId/todos`
List todos for a specific thought.

```bash
curl -sS "$IBX_BASE_URL/api/thoughts/<externalId>/todos?today=2026-04-03" \
  -H "Authorization: Bearer $IBX_API_KEY"
```

### `POST /api/thoughts/:externalId/generate`
Run AI generation for an existing thought.

```bash
curl -sS -X POST "$IBX_BASE_URL/api/thoughts/<externalId>/generate" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"today":"2026-04-03"}'
```

### `GET /api/calendar/feed-token`
Get current active ICS feed token metadata (does not return raw token).

```bash
curl -sS "$IBX_BASE_URL/api/calendar/feed-token" \
  -H "Authorization: Bearer $IBX_API_KEY"
```

### `POST /api/calendar/feed-token`
Rotate calendar feed token and return a new private ICS URL.

```bash
curl -sS -X POST "$IBX_BASE_URL/api/calendar/feed-token" \
  -H "Authorization: Bearer $IBX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### `GET /api/calendar/ics?token=...`
Read-only ICS feed URL for calendar subscription (private URL token).

```bash
curl -sS "$IBX_BASE_URL/api/calendar/ics?token=icf_xxx"
```

## Notes

- Session-only endpoints (`/api/login`, `/api/logout`, `/api/api-keys*`) are for browser cookie auth, not for bearer-key integrations.
- Keep ICS feed URLs private; anyone with the tokenized URL can read scheduled open todos.
- Keep API keys server-side or in trusted environments.
