# ibx Apple Shortcut

This directory generates an Apple Shortcut that captures one text input and:

- posts directly to `POST https://ibx.egeuysal.com/api/todos/generate` with `Authorization: Bearer iak_...`
- if network is unavailable, uses **Open App** (set this action to your installed ibx home-screen app once)

Important:
- After importing the shortcut, edit the **Open App** action and select your ibx home-screen app once.
- Open ibx once while online after installing/updating so assets stay warm for offline usage.

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

The shortcut contains a text action named `API Key (Edit Once)` with `iak_replace_me`.
Edit that action one time after install and set your real `iak_...` key.
After that, it sends directly to API when online without asking every run.
If your PWA is already installed, iOS can open the same app URL and queue locally when offline.
