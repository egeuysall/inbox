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
ibx td
```

## commands

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

## local build

```bash
pnpm cli:build
pnpm cli:bundle
```
