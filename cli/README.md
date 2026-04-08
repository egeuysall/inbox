# ibx CLI

`ibx` is a TypeScript CLI for ibx with API-key auth (`iak_...`) and Bearer requests.

## install (no npm publish needed)

```bash
curl -fsSL https://ibx.egeuysal.com/install.sh | bash
```

## quick start

```bash
ibx auth login --api-key iak_xxx
ibx add "finish landing page and email two leads" --auto-schedule
ibx todos list --view today
ibx td
```

## commands

- `ibx auth login [--api-key iak_...] [--url https://ibx.egeuysal.com]`
- `ibx a l [--api-key iak_...] [--url https://ibx.egeuysal.com]` (short)
- `ibx auth status`
- `ibx a s` (short)
- `ibx auth logout`
- `ibx a o` (short)
- `ibx add [--input "..."] [--auto-schedule|--no-auto-schedule] [--include-links|--no-include-links] [--require-descriptions|--no-require-descriptions] [--availability-notes "..."]`
- `ibx n [--input "..."]` (short)
- `ibx todos list [--view today|upcoming|archive|all] [--json]`
- `ibx t l [--view today|upcoming|archive|all] [--json]` (short)
- `ibx td` (today's completed tasks in `America/Chicago`, override with `IBX_TIMEZONE`)
- `ibx todos done --id <todoId|prefix>`
- `ibx t x --id <todoId|prefix>` (short)
- `ibx todos open --id <todoId|prefix>`
- `ibx t o --id <todoId|prefix>` (short)
- `ibx todos delete --id <todoId|prefix>`
- `ibx t d --id <todoId|prefix>` (short)
- `ibx todos set --id <todoId|prefix> [--title "new title"] [--notes "..."] [--notes-null] [--due YYYY-MM-DD] [--hours 1.5|90m|1h] [--start HH:mm|HH:mm am/pm|clear] [--priority 1|2|3] [--recurrence none|daily|weekly|monthly]`
- `ibx t s --id <todoId|prefix> [same flags]` (short)
- `ibx calendar status`
- `ibx cal s` (short)
- `ibx calendar rotate` (rotate + print new ICS feed URL)
- `ibx cal r` (short)

## reliability + exits

- network timeout + bounded retries are enabled for API calls.
- structured logs are emitted to stderr (`timestamp level action=...`).
- CLI checks once per day for updates via `GET /ibx-version.json` and prints an install command when newer.
- set `IBX_DISABLE_UPDATE_CHECK=1` to disable update checks.
- stable exit codes:
  - `2` validation/input error
  - `3` auth error
  - `4` network/timeout
  - `5` server error
  - `6` not found
  - `7` conflict/ambiguous target
  - `8` rate limit

## local build

```bash
bun run cli:build
bun run cli:bundle
```
