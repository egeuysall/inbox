# ibx CLI

`ibx` is a TypeScript CLI for ibx with API-key auth (`iak_...`) and Bearer requests.

## install (no npm publish needed)

```bash
curl -fsSL https://ibx.egeuysal.com/install.sh | bash
```

## quick start

```bash
ibx auth login --api-key iak_xxx
ibx add "finish landing page and email two leads"
ibx todos list --view today
```

## commands

- `ibx auth login [--api-key iak_...] [--url https://ibx.egeuysal.com]`
- `ibx auth status`
- `ibx auth logout`
- `ibx add [--input "..."]`
- `ibx todos list [--view today|upcoming|archive|all] [--json]`
- `ibx todos done --id <todoId|prefix>`
- `ibx todos open --id <todoId|prefix>`
- `ibx todos delete --id <todoId|prefix>`
- `ibx todos set --id <todoId|prefix> [--title "new title"] [--due YYYY-MM-DD] [--priority 1|2|3] [--recurrence none|daily|weekly|monthly]`

## local build

```bash
pnpm cli:build
pnpm cli:bundle
```
