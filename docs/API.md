# ibx HTTP API

Base URL:

- Production: `https://ibx.egeuysal.com`
- Preview/local: your deployment URL or `http://localhost:3000`

All responses are JSON.

## Authentication

ibx supports two auth modes:

1. Session cookie (`ibx_session`) for first-party web app usage.
2. API key (`Authorization: Bearer iak_...`) for integrations/CLI.

Recommended for integrations: API keys.

### Create an API key

API key management endpoints require a valid session cookie:

- `POST /api/api-keys`

Request:

```json
{
  "name": "my-integration"
}
```

Response:

```json
{
  "ok": true,
  "apiKey": "iak_...",
  "key": {
    "id": "...",
    "name": "my-integration",
    "prefix": "iak",
    "last4": "abcd"
  }
}
```

The raw key is only returned once.

## Endpoints (API key compatible)

### Health/auth check

- `GET /api/session`

With Bearer auth, returns:

```json
{
  "authenticated": true,
  "authType": "apiKey",
  "expiresAt": null
}
```

### Thoughts

- `GET /api/thoughts`
- `POST /api/thoughts/sync`
- `GET /api/thoughts/:externalId/todos`
- `POST /api/thoughts/:externalId/todos`
- `POST /api/thoughts/:externalId/generate`

#### POST /api/thoughts/sync

```json
{
  "thoughts": [
    {
      "externalId": "uuid",
      "rawText": "raw thought",
      "createdAt": 1760000000000,
      "status": "pending",
      "aiRunId": null
    }
  ]
}
```

#### POST /api/thoughts/:externalId/todos

```json
{
  "title": "follow up with 2 leads",
  "notes": "send concise follow-up with CTA",
  "dueDate": "2026-04-04",
  "recurrence": "none"
}
```

#### POST /api/thoughts/:externalId/generate

Body: empty.

Creates todos from a previously synced thought.

### Todos

- `GET /api/todos`
- `POST /api/todos/generate`
- `PATCH /api/todos/:todoId`
- `DELETE /api/todos/:todoId`

#### POST /api/todos/generate

```json
{
  "text": "finish landing page and email two leads"
}
```

Response:

```json
{
  "ok": true,
  "runId": "uuid",
  "created": 3
}
```

#### PATCH /api/todos/:todoId

You can update status and/or schedule fields.

```json
{
  "status": "done",
  "dueDate": "2026-04-05",
  "priority": 1,
  "recurrence": "daily"
}
```

Valid values:

- `status`: `open | done`
- `priority`: `1 | 2 | 3`
- `recurrence`: `none | daily | weekly | monthly`
- `dueDate`: `YYYY-MM-DD` or `null`

#### DELETE /api/todos/:todoId

Deletes a todo by id.

## API key management endpoints

Session-auth only:

- `GET /api/api-keys` (active keys only)
- `POST /api/api-keys`
- `DELETE /api/api-keys/:keyId` (revoke)

Revoked keys are not returned in list responses and cannot authenticate.

## Error format

Most errors return:

```json
{
  "error": "message"
}
```

Typical status codes:

- `400` invalid input
- `401` unauthorized
- `403` forbidden (CSRF/session-origin check failure)
- `404` resource not found
- `429` login rate limit
- `500` internal or AI generation failure

## Integration examples

### cURL

```bash
curl -sS https://ibx.egeuysal.com/api/todos \
  -H "Authorization: Bearer iak_your_key_here" \
  -H "Accept: application/json"
```

```bash
curl -sS https://ibx.egeuysal.com/api/todos/generate \
  -X POST \
  -H "Authorization: Bearer iak_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"text":"draft launch post and follow up with 3 leads"}'
```

### Node.js (server-side)

```ts
const res = await fetch("https://ibx.egeuysal.com/api/todos", {
  headers: {
    Authorization: `Bearer ${process.env.IBX_API_KEY!}`,
    Accept: "application/json",
  },
});

if (!res.ok) throw new Error(`ibx API failed: ${res.status}`);
const data = await res.json();
```

## Notes

- API keys should be used from trusted server environments.
- Keep keys out of browser bundles and public repos.
- For browser usage from other origins, route through your backend (recommended).
