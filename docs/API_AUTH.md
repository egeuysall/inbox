# ibx API Authentication

This document explains how to authenticate against ibx endpoints.

## Auth modes

ibx accepts two auth modes:

1. Session cookie (`ibx_session`) for first-party browser usage.
2. API key (`Authorization: Bearer iak_...`) for CLI and external integrations.

## API keys (`iak_...`)

- Key format: `iak_<random>`
- Keys are generated with cryptographic randomness.
- Only SHA-256 hashes are stored server-side.
- Revoked keys cannot authenticate.

### Create and revoke keys

Key management requires a valid session cookie:

- `GET /api/api-keys`
- `POST /api/api-keys`
- `DELETE /api/api-keys/:keyId`

Use API keys for app-to-app or server-to-server calls.

## Session auth

- Login endpoint: `POST /api/login`
- Logout endpoint: `POST /api/logout`
- Session check: `GET /api/session`

Session cookies are:

- `HttpOnly`
- `SameSite=Lax`
- `Secure` in production by default

## CSRF protection behavior

For non-GET requests authenticated via session cookie, ibx validates request origin (`Origin` or `Referer`).

This means:

- First-party browser app works normally.
- Cross-site forged requests are rejected with `403`.
- Bearer API key requests are not subject to session CSRF checks.

## Integration recommendation

Use API keys from your backend/runtime environment and keep keys out of public browser code.

Example:

```http
Authorization: Bearer iak_xxxxxxxxx
```
