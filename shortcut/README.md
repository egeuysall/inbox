# ibx Apple Shortcut

This directory generates an Apple Shortcut that captures one text input and:

- posts directly to `POST https://ibx.egeuysal.com/api/todos/generate` with `Authorization: Bearer iak_...`
- if network is unavailable, opens
  `https://ibx.egeuysal.com/?shortcut=<encoded-text>&source=shortcut` so the app can queue it offline

## Build shortcut file

```bash
pnpm --dir shortcut build
```

Output files:

- `shortcut/dist/ibx-capture.shortcut`
- `public/shortcuts/ibx-capture.shortcut` (signed with `shortcuts sign --mode anyone`)

## Install on iPhone

1. Open this URL on iPhone Safari:
   - `https://ibx.egeuysal.com/shortcuts/ibx-capture.shortcut`
2. Import into the Shortcuts app.
3. Run `ibx capture`, type your thought, submit.

The shortcut asks for an API key (`iak_...`) and sends directly to API when online.
If your PWA is already installed, iOS can open the same app URL and queue locally when offline.
