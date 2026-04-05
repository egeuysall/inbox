#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import { safeJsonStringify } from "flags";

type TodoStatus = "open" | "done";
type TodoRecurrence = "none" | "daily" | "weekly" | "monthly";
type TodoPriority = 1 | 2 | 3;
type ViewMode = "today" | "upcoming" | "archive" | "all";

type TodoItem = {
  id: string;
  thoughtId: string;
  title: string;
  notes: string | null;
  status: TodoStatus;
  dueDate: number | null;
  priority: TodoPriority;
  recurrence: TodoRecurrence;
  source: "ai" | "manual";
  createdAt: number;
};

type CliConfig = {
  baseUrl: string;
  apiKey: string;
  createdAt: string;
};

type ParsedArgs = {
  positionals: string[];
  options: Record<string, string | boolean>;
};

const CONFIG_FILE = join(homedir(), ".ibx", "config.json");
const API_KEY_PREFIX = "iak_";
const VERSION = "0.2.0";
const DEFAULT_BASE_URL =
  process.env.IBX_BASE_URL?.trim() || "https://ibx.egeuysal.com";

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const color = {
  dim: (value: string) => (useColor ? `\x1b[2m${value}\x1b[0m` : value),
  gray: (value: string) => (useColor ? `\x1b[90m${value}\x1b[0m` : value),
  red: (value: string) => (useColor ? `\x1b[31m${value}\x1b[0m` : value),
  green: (value: string) => (useColor ? `\x1b[32m${value}\x1b[0m` : value),
  yellow: (value: string) => (useColor ? `\x1b[33m${value}\x1b[0m` : value),
  blue: (value: string) => (useColor ? `\x1b[34m${value}\x1b[0m` : value),
  magenta: (value: string) => (useColor ? `\x1b[35m${value}\x1b[0m` : value),
  cyan: (value: string) => (useColor ? `\x1b[36m${value}\x1b[0m` : value),
  bold: (value: string) => (useColor ? `\x1b[1m${value}\x1b[0m` : value),
};

function print(message = "") {
  process.stdout.write(`${message}\n`);
}

function printError(message: string) {
  process.stderr.write(`${color.red("error")}: ${message}\n`);
}

function printInfo(message: string) {
  print(`${color.cyan("i")} ${message}`);
}

function printOk(message: string) {
  print(`${color.green("ok")} ${message}`);
}

function printWarn(message: string) {
  print(`${color.yellow("warn")} ${message}`);
}

function printJson(value: unknown) {
  print(safeJsonStringify(value, null, 2));
}

function normalizeBaseUrl(input: string) {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Base URL is required.");
  }

  const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must use http or https.");
  }

  return url.toString().replace(/\/$/, "");
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith("--")) {
      const [key, rawValue] = token.slice(2).split("=", 2);
      if (!key) {
        continue;
      }

      if (rawValue !== undefined) {
        options[key] = rawValue;
        continue;
      }

      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        options[key] = next;
        index += 1;
      } else {
        options[key] = true;
      }
      continue;
    }

    const shortFlags = token.slice(1);
    for (const flag of shortFlags) {
      if (flag === "h") {
        options.help = true;
      }
      if (flag === "v") {
        options.version = true;
      }
      if (flag === "j") {
        options.json = true;
      }
    }
  }

  return { positionals, options };
}

function getStringOption(parsed: ParsedArgs, name: string): string | null {
  const value = parsed.options[name];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasFlag(parsed: ParsedArgs, name: string) {
  return parsed.options[name] === true;
}

async function loadConfig(): Promise<CliConfig | null> {
  const raw = await readFile(CONFIG_FILE, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as Partial<CliConfig>;
  if (
    typeof parsed.baseUrl !== "string" ||
    typeof parsed.apiKey !== "string" ||
    typeof parsed.createdAt !== "string"
  ) {
    return null;
  }

  if (!parsed.apiKey.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  return {
    baseUrl: normalizeBaseUrl(parsed.baseUrl),
    apiKey: parsed.apiKey,
    createdAt: parsed.createdAt,
  };
}

async function saveConfig(config: CliConfig) {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(
    CONFIG_FILE,
    `${safeJsonStringify(config, null, 2)}\n`,
    "utf8",
  );
}

async function clearConfig() {
  await rm(CONFIG_FILE, { force: true });
}

async function requireConfig() {
  const config = await loadConfig();
  if (!config) {
    throw new Error(
      'Not authenticated. Run "ibx auth login --api-key iak_..." first.',
    );
  }

  return config;
}

async function requestJson<T>(
  config: Pick<CliConfig, "baseUrl" | "apiKey">,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": `ibx/${VERSION}`,
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;

  if (!response.ok) {
    const message =
      payload.error || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function verifyAuth(baseUrl: string, apiKey: string) {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": `ibx/${VERSION}`,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    authenticated?: boolean;
    authType?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(
      payload.error || `Auth verification failed (${response.status}).`,
    );
  }

  if (!payload.authenticated) {
    throw new Error("API key is not valid for this server.");
  }

  return payload;
}

function formatDate(value: number | null) {
  if (value === null) {
    return "no date";
  }

  return new Date(value).toISOString().slice(0, 10);
}

function getStartOfUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function sortTodos(items: TodoItem[]) {
  return [...items].sort((left, right) => {
    const leftDate = left.dueDate ?? Number.MAX_SAFE_INTEGER;
    const rightDate = right.dueDate ?? Number.MAX_SAFE_INTEGER;

    if (leftDate !== rightDate) {
      return leftDate - rightDate;
    }

    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return left.createdAt - right.createdAt;
  });
}

function filterTodosByView(items: TodoItem[], view: ViewMode) {
  if (view === "all") {
    return sortTodos(items);
  }

  const todayStartUtc = getStartOfUtcDay(Date.now());
  const dayMs = 24 * 60 * 60 * 1000;

  if (view === "today") {
    return sortTodos(
      items.filter(
        (todo) =>
          todo.status === "open" &&
          todo.dueDate !== null &&
          todo.dueDate >= todayStartUtc &&
          todo.dueDate < todayStartUtc + dayMs,
      ),
    );
  }

  if (view === "upcoming") {
    return sortTodos(
      items.filter(
        (todo) =>
          todo.status === "open" &&
          todo.dueDate !== null &&
          todo.dueDate >= todayStartUtc,
      ),
    );
  }

  return sortTodos(items.filter((todo) => todo.status === "done"));
}

function statusBadge(status: TodoStatus) {
  return status === "done" ? color.green("[x]") : color.dim("[ ]");
}

function priorityBadge(priority: TodoPriority) {
  if (priority === 1) {
    return color.red("p1");
  }

  if (priority === 2) {
    return color.yellow("p2");
  }

  return color.blue("p3");
}

function printTodoList(items: TodoItem[], view: ViewMode) {
  if (items.length === 0) {
    print(color.gray("(empty)"));
    return;
  }

  let currentGroup = "";
  for (const todo of items) {
    const shouldGroup = view === "upcoming" || view === "archive";
    const nextGroup = shouldGroup ? formatDate(todo.dueDate) : "";

    if (shouldGroup && nextGroup !== currentGroup) {
      currentGroup = nextGroup;
      print(`\n${color.bold(nextGroup)}`);
    }

    print(`${statusBadge(todo.status)} ${color.bold(todo.title)}`);
    print(`  ${color.gray("id:")} ${todo.id}`);
    print(
      `  ${color.gray("meta:")} ${formatDate(todo.dueDate)} / ${priorityBadge(todo.priority)} / ${todo.recurrence}`,
    );

    if (todo.notes) {
      const preview =
        todo.notes.length > 180 ? `${todo.notes.slice(0, 180)}...` : todo.notes;
      print(`  ${color.gray("notes:")} ${preview}`);
    }

    print("");
  }
}

function parsePriority(value: string | null): TodoPriority | null {
  if (value === "1" || value === "2" || value === "3") {
    return Number(value) as TodoPriority;
  }

  return null;
}

function parseRecurrence(value: string | null): TodoRecurrence | null {
  if (
    value === "none" ||
    value === "daily" ||
    value === "weekly" ||
    value === "monthly"
  ) {
    return value;
  }

  return null;
}

function parseView(value: string | null): ViewMode {
  if (
    value === "today" ||
    value === "upcoming" ||
    value === "archive" ||
    value === "all"
  ) {
    return value;
  }

  return "today";
}

async function readFromStdin() {
  if (process.stdin.isTTY) {
    return null;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length ? text : null;
}

async function promptForInput(promptText: string) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const value = (await rl.question(promptText)).trim();
  rl.close();

  return value.length ? value : null;
}

async function resolveAiInput(parsed: ParsedArgs) {
  const fromOption = getStringOption(parsed, "input");
  if (fromOption) {
    return fromOption;
  }

  const fromPositional = parsed.positionals.slice(2).join(" ").trim();
  if (fromPositional.length > 0) {
    return fromPositional;
  }

  const fromStdin = await readFromStdin();
  if (fromStdin) {
    return fromStdin;
  }

  if (process.stdin.isTTY) {
    return promptForInput(`${color.cyan(">")} what's in your mind? `);
  }

  return null;
}

function printHelp() {
  print(`${color.bold("ibx")} ${color.gray(VERSION)}`);
  print(color.gray("terminal workflow for ibx"));
  print("");
  print(color.bold("quick start"));
  print(
    `  ibx auth login --api-key iak_... ${color.gray("(defaults to https://ibx.egeuysal.com)")}`,
  );
  print('  ibx add "finish landing page + send 2 follow-ups"');
  print("");
  print(color.bold("commands"));
  print(
    "  ibx auth login [--api-key iak_...] [--url https://ibx.egeuysal.com]",
  );
  print("  ibx auth status");
  print("  ibx auth logout");
  print('  ibx add [--input "..."]');
  print("  ibx todos list [--view today|upcoming|archive|all] [--json]");
  print("  ibx todos done --id <todoId|prefix>");
  print("  ibx todos open --id <todoId|prefix>");
  print("  ibx todos delete --id <todoId|prefix>");
  print(
    "  ibx todos set --id <todoId|prefix> [--title \"new title\"] [--due YYYY-MM-DD] [--priority 1|2|3] [--recurrence none|daily|weekly|monthly]",
  );
}

async function runAuthCommand(parsed: ParsedArgs) {
  const subcommand = parsed.positionals[1] ?? "status";
  const outputJson = hasFlag(parsed, "json");

  if (subcommand === "login") {
    const apiKey =
      getStringOption(parsed, "api-key") ??
      process.env.IBX_API_KEY?.trim() ??
      null;
    const baseUrlInput = getStringOption(parsed, "url") ?? DEFAULT_BASE_URL;

    if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) {
      throw new Error(
        "Provide a valid API key with --api-key (must start with iak_).\nexample: ibx auth login --api-key iak_... ",
      );
    }

    const baseUrl = normalizeBaseUrl(baseUrlInput);
    const verification = await verifyAuth(baseUrl, apiKey);

    const config: CliConfig = {
      baseUrl,
      apiKey,
      createdAt: new Date().toISOString(),
    };

    await saveConfig(config);

    if (outputJson) {
      printJson({
        ok: true,
        baseUrl,
        authType: verification.authType ?? "apiKey",
      });
      return;
    }

    printOk(`connected to ${baseUrl}`);
    printInfo(`auth: ${verification.authType ?? "apiKey"}`);
    return;
  }

  if (subcommand === "logout") {
    await clearConfig();

    if (outputJson) {
      printJson({ ok: true });
      return;
    }

    printOk("signed out locally");
    return;
  }

  if (subcommand === "status") {
    const config = await loadConfig();
    if (!config) {
      if (outputJson) {
        printJson({ authenticated: false });
        return;
      }

      printWarn("not authenticated");
      print(color.gray("run: ibx auth login --api-key iak_..."));
      return;
    }

    try {
      const verification = await verifyAuth(config.baseUrl, config.apiKey);
      if (outputJson) {
        printJson({
          authenticated: true,
          authType: verification.authType ?? "apiKey",
          baseUrl: config.baseUrl,
          keyHint: `${API_KEY_PREFIX}...${config.apiKey.slice(-4)}`,
        });
        return;
      }

      printOk(`authenticated (${verification.authType ?? "apiKey"})`);
      print(`${color.gray("server:")} ${config.baseUrl}`);
      print(
        `${color.gray("key:")} ${API_KEY_PREFIX}...${config.apiKey.slice(-4)}`,
      );
      return;
    } catch (error) {
      if (outputJson) {
        printJson({
          authenticated: false,
          error: error instanceof Error ? error.message : "auth failed",
        });
        return;
      }

      printWarn("saved credentials are invalid");
      throw error;
    }
  }

  throw new Error(`Unknown auth subcommand: ${subcommand}`);
}

async function runAddCommand(parsed: ParsedArgs) {
  const outputJson = hasFlag(parsed, "json");
  const config = await requireConfig();
  const input = await resolveAiInput(parsed);

  if (!input) {
    throw new Error(
      'No input provided.\nexample: ibx add "finish landing page and email two leads"',
    );
  }

  printInfo("sending thought to ai...");

  const response = await requestJson<{
    ok: true;
    runId: string;
    created: number;
  }>(config, "/api/todos/generate", {
    method: "POST",
    body: JSON.stringify({ text: input }),
  });

  if (outputJson) {
    printJson(response);
    return;
  }

  printOk(`run ${response.runId}`);
  printOk(
    `created ${response.created} todo${response.created === 1 ? "" : "s"}`,
  );
  if (response.created === 0) {
    printWarn(
      "ai did not create new todos (likely duplicate or low-signal input)",
    );
  }
}

async function resolveTodoId(
  config: Pick<CliConfig, "baseUrl" | "apiKey">,
  idOrPrefix: string,
) {
  const candidate = idOrPrefix.trim();
  if (candidate.length < 4) {
    throw new Error("Todo id must be full id or at least 4 characters.");
  }

  const response = await requestJson<{ todos: TodoItem[] }>(
    config,
    "/api/todos",
    {
      method: "GET",
    },
  );

  const exactMatch = response.todos.find((todo) => todo.id === candidate);
  if (exactMatch) {
    return exactMatch.id;
  }

  const prefixMatches = response.todos.filter((todo) =>
    todo.id.startsWith(candidate),
  );
  if (prefixMatches.length === 1) {
    return prefixMatches[0].id;
  }

  if (prefixMatches.length === 0) {
    throw new Error(`No todo matches "${candidate}".`);
  }

  throw new Error(
    `Ambiguous todo id prefix "${candidate}" (${prefixMatches.length} matches). Use more characters or full id.`,
  );
}

async function runTodosCommand(parsed: ParsedArgs) {
  const subcommand = parsed.positionals[1] ?? "list";
  const outputJson = hasFlag(parsed, "json");
  const config = await requireConfig();

  if (subcommand === "list") {
    const view = parseView(getStringOption(parsed, "view"));
    const response = await requestJson<{ todos: TodoItem[] }>(
      config,
      "/api/todos",
      {
        method: "GET",
      },
    );

    const filtered = filterTodosByView(response.todos, view);

    if (outputJson) {
      printJson({ view, todos: filtered });
      return;
    }

    print(`${color.bold(view)} ${color.gray(String(filtered.length))}`);
    printTodoList(filtered, view);
    return;
  }

  if (subcommand === "run") {
    await runAddCommand(parsed);
    return;
  }

  if (subcommand === "done" || subcommand === "open") {
    const todoIdInput =
      getStringOption(parsed, "id") ?? parsed.positionals[2] ?? null;
    if (!todoIdInput) {
      throw new Error("Provide todo id with --id.");
    }
    const todoId = await resolveTodoId(config, todoIdInput);

    await requestJson<{ ok: true }>(config, `/api/todos/${todoId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: subcommand === "done" ? "done" : "open" }),
    });

    if (outputJson) {
      printJson({ ok: true, id: todoId, status: subcommand });
      return;
    }

    printOk(`${subcommand} ${todoId}`);
    return;
  }

  if (subcommand === "delete" || subcommand === "remove") {
    const todoIdInput =
      getStringOption(parsed, "id") ?? parsed.positionals[2] ?? null;
    if (!todoIdInput) {
      throw new Error("Provide todo id with --id.");
    }
    const todoId = await resolveTodoId(config, todoIdInput);

    await requestJson<{ ok: true }>(config, `/api/todos/${todoId}`, {
      method: "DELETE",
    });

    if (outputJson) {
      printJson({ ok: true, id: todoId, status: "deleted" });
      return;
    }

    printOk(`deleted ${todoId}`);
    return;
  }

  if (subcommand === "set") {
    const todoIdInput =
      getStringOption(parsed, "id") ?? parsed.positionals[2] ?? null;
    if (!todoIdInput) {
      throw new Error("Provide todo id with --id.");
    }
    const todoId = await resolveTodoId(config, todoIdInput);

    const due = getStringOption(parsed, "due");
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      throw new Error("--due must be in YYYY-MM-DD format.");
    }

    const recurrence = parseRecurrence(getStringOption(parsed, "recurrence"));
    if (getStringOption(parsed, "recurrence") && !recurrence) {
      throw new Error(
        "--recurrence must be one of: none, daily, weekly, monthly.",
      );
    }

    const priority = parsePriority(getStringOption(parsed, "priority"));
    if (getStringOption(parsed, "priority") && !priority) {
      throw new Error("--priority must be one of: 1, 2, 3.");
    }

    const titleInput = getStringOption(parsed, "title");
    const title =
      titleInput !== null ? titleInput.trim().slice(0, 140) : null;
    if (titleInput !== null && !title) {
      throw new Error("--title cannot be empty.");
    }

    const payload: {
      dueDate?: string | null;
      recurrence?: TodoRecurrence;
      priority?: TodoPriority;
      title?: string;
    } = {};

    if (due !== null) {
      payload.dueDate = due;
    }

    if (recurrence !== null) {
      payload.recurrence = recurrence;
    }

    if (priority !== null) {
      payload.priority = priority;
    }

    if (title !== null) {
      payload.title = title;
    }

    if (Object.keys(payload).length === 0) {
      throw new Error(
        "Nothing to update. Set at least one of --title, --due, --recurrence, --priority.",
      );
    }

    await requestJson<{ ok: true }>(config, `/api/todos/${todoId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    if (outputJson) {
      printJson({ ok: true, id: todoId, ...payload });
      return;
    }

    printOk(`updated ${todoId}`);
    return;
  }

  throw new Error(`Unknown todos subcommand: ${subcommand}`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const first = parsed.positionals[0];

  if (hasFlag(parsed, "help") || first === "help") {
    printHelp();
    return;
  }

  if (hasFlag(parsed, "version") || first === "version") {
    print(VERSION);
    return;
  }

  if (!first) {
    print(`${color.bold("ibx")} ${color.gray("quick capture")}`);
    await runAddCommand({
      ...parsed,
      positionals: ["add"],
    });
    return;
  }

  if (first === "auth") {
    await runAuthCommand(parsed);
    return;
  }

  if (first === "add") {
    await runAddCommand(parsed);
    return;
  }

  if (first === "todos") {
    await runTodosCommand(parsed);
    return;
  }

  throw new Error(`Unknown command: ${first}`);
}

void main().catch((error) => {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
