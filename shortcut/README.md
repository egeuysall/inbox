# ibx Apple Shortcut

This directory generates an Apple Shortcut that captures one text input and:

- posts directly to `POST https://ibx.egeuysal.com/api/todos/generate` with `Authorization: Bearer iak_...`
- if network is unavailable, stores the capture in a local Notes entry prefixed with `IBX_QUEUE`

Important:
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

## Offline queue strategy

When offline, this shortcut writes:

```text
IBX_QUEUE
captureId: ...
createdAt: ...
text: ...
```

to Notes. This avoids unreliable PWA URL handoff on iOS.

Then use a separate personal automation/shortcut to:

1. Find notes containing `IBX_QUEUE`
2. Extract the `text:` line
3. `POST https://ibx.egeuysal.com/api/todos/generate` with `Authorization: Bearer iak_...`
4. Delete/archive processed notes
