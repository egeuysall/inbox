#!/usr/bin/env node

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  estimatedHours: number | null;
  timeBlockStart: number | null;
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

type CliVersionManifest = {
  version?: unknown;
};

type UpdateCheckCache = {
  lastCheckedAt: number;
  baseUrl: string;
  latestVersion: string | null;
  lastNotifiedVersion: string | null;
};

type ParsedArgs = {
  positionals: string[];
  options: Record<string, string | boolean>;
};

const CONFIG_FILE = join(homedir(), ".ibx", "config.json");
const UPDATE_CHECK_FILE = join(homedir(), ".ibx", "update-check.json");
const API_KEY_PREFIX = "iak_";
const VERSION = "0.3.0";
const DEFAULT_BASE_URL =
  process.env.IBX_BASE_URL?.trim() || "https://ibx.egeuysal.com";
const APP_TIMEZONE = process.env.IBX_TIMEZONE?.trim() || "America/Chicago";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 3_500;

const EXIT_CODE = {
  UNKNOWN: 1,
  VALIDATION: 2,
  AUTH: 3,
  NETWORK: 4,
  SERVER: 5,
  NOT_FOUND: 6,
  CONFLICT: 7,
  RATE_LIMIT: 8,
} as const;

type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

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

class CliError extends Error {
  exitCode: ExitCode;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      exitCode?: ExitCode;
      code?: string;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "CliError";
    this.exitCode = options?.exitCode ?? EXIT_CODE.UNKNOWN;
    this.code = options?.code ?? "UNKNOWN";
    this.details = options?.details;
  }
}

type LogLevel = "info" | "warn" | "error";

function isInterruptedError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  if ((error as { code?: string }).code === "ABORT_ERR") {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes("ctrl+c") || message.includes("interrupted");
}

function stringifyLogValue(value: unknown) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return safeJsonStringify(value);
}

function logEvent(
  level: LogLevel,
  action: string,
  fields: Record<string, unknown> = {},
) {
  const timestamp = new Date().toISOString();
  const levelLabel =
    level === "info"
      ? color.cyan(level)
      : level === "warn"
        ? color.yellow(level)
        : color.red(level);
  const serializedFields = Object.entries(fields)
    .map(([key, value]) => `${key}=${stringifyLogValue(value)}`)
    .join(" ");
  const line = `${color.gray(timestamp)} ${levelLabel} action=${action}${
    serializedFields ? ` ${serializedFields}` : ""
  }`;
  process.stderr.write(`${line}\n`);
}

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

function colorizeJson(json: string) {
  if (!useColor) {
    return json;
  }

  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (token) => {
      if (token.startsWith('"')) {
        if (token.endsWith(":")) {
          return color.bold(color.cyan(token));
        }

        return color.green(token);
      }

      if (token === "true" || token === "false") {
        return color.yellow(token);
      }

      if (token === "null") {
        return color.gray(token);
      }

      return color.magenta(token);
    },
  );
}

function printJson(value: unknown) {
  const json = safeJsonStringify(value, null, 2);
  print(colorizeJson(json));
}

function normalizeBaseUrl(input: string) {
  const raw = input.trim();
  if (!raw) {
    throw new CliError("Base URL is required.", {
      exitCode: EXIT_CODE.VALIDATION,
      code: "BASE_URL_REQUIRED",
    });
  }

  const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("Base URL must use http or https.", {
      exitCode: EXIT_CODE.VALIDATION,
      code: "BASE_URL_PROTOCOL",
    });
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

  const parsed = (() => {
    try {
      return JSON.parse(raw) as Partial<CliConfig>;
    } catch {
      return null;
    }
  })();
  if (!parsed) {
    return null;
  }
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

  try {
    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      apiKey: parsed.apiKey,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

async function saveConfig(config: CliConfig) {
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(
    CONFIG_FILE,
    `${safeJsonStringify(config, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(CONFIG_FILE, 0o600).catch(() => undefined);
}

async function clearConfig() {
  await rm(CONFIG_FILE, { force: true });
}

function parseSemver(version: string) {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch)
  ) {
    return null;
  }

  return { major, minor, patch };
}

function isVersionNewer(latest: string, current: string) {
  const latestParsed = parseSemver(latest);
  const currentParsed = parseSemver(current);
  if (!latestParsed || !currentParsed) {
    return false;
  }

  if (latestParsed.major !== currentParsed.major) {
    return latestParsed.major > currentParsed.major;
  }

  if (latestParsed.minor !== currentParsed.minor) {
    return latestParsed.minor > currentParsed.minor;
  }

  return latestParsed.patch > currentParsed.patch;
}

async function loadUpdateCheckCache(): Promise<UpdateCheckCache | null> {
  const raw = await readFile(UPDATE_CHECK_FILE, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  const parsed = (() => {
    try {
      return JSON.parse(raw) as Partial<UpdateCheckCache>;
    } catch {
      return null;
    }
  })();
  if (!parsed) {
    return null;
  }

  if (
    typeof parsed.lastCheckedAt !== "number" ||
    !Number.isFinite(parsed.lastCheckedAt) ||
    typeof parsed.baseUrl !== "string" ||
    (typeof parsed.latestVersion !== "string" && parsed.latestVersion !== null)
  ) {
    return null;
  }

  return {
    lastCheckedAt: parsed.lastCheckedAt,
    baseUrl: parsed.baseUrl,
    latestVersion: parsed.latestVersion,
    lastNotifiedVersion:
      typeof parsed.lastNotifiedVersion === "string"
        ? parsed.lastNotifiedVersion
        : null,
  };
}

async function saveUpdateCheckCache(cache: UpdateCheckCache) {
  await mkdir(dirname(UPDATE_CHECK_FILE), { recursive: true });
  await writeFile(
    UPDATE_CHECK_FILE,
    `${safeJsonStringify(cache, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(UPDATE_CHECK_FILE, 0o600).catch(() => undefined);
}

async function fetchLatestCliVersion(baseUrl: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort("timeout"),
    UPDATE_CHECK_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${baseUrl}/ibx-version.json`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": `ibx/${VERSION}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as
      | CliVersionManifest
      | null;
    if (!payload || typeof payload.version !== "string") {
      return null;
    }

    return parseSemver(payload.version) ? payload.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkForCliUpdates(command: string | undefined, parsed: ParsedArgs) {
  if (process.env.IBX_DISABLE_UPDATE_CHECK === "1") {
    return;
  }

  let baseUrl = DEFAULT_BASE_URL;
  if (
    command === "auth" &&
    normalizeAuthSubcommand(parsed.positionals[1] ?? "status") === "login"
  ) {
    const loginUrl = getStringOption(parsed, "url");
    if (loginUrl) {
      try {
        baseUrl = normalizeBaseUrl(loginUrl);
      } catch {
        baseUrl = DEFAULT_BASE_URL;
      }
    }
  } else {
    const config = await loadConfig();
    if (config?.baseUrl) {
      baseUrl = config.baseUrl;
    }
  }

  const now = Date.now();
  const existingCache = await loadUpdateCheckCache();
  let cache: UpdateCheckCache =
    existingCache ?? {
      lastCheckedAt: 0,
      baseUrl,
      latestVersion: null,
      lastNotifiedVersion: null,
    };
  const shouldRefresh =
    cache.baseUrl !== baseUrl ||
    now - cache.lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;

  if (shouldRefresh) {
    const latestVersion = await fetchLatestCliVersion(baseUrl);
    cache = {
      ...cache,
      baseUrl,
      lastCheckedAt: now,
      latestVersion,
      lastNotifiedVersion:
        latestVersion && latestVersion === cache.lastNotifiedVersion
          ? cache.lastNotifiedVersion
          : null,
    };
    await saveUpdateCheckCache(cache).catch(() => undefined);
  }

  if (!cache.latestVersion || !isVersionNewer(cache.latestVersion, VERSION)) {
    return;
  }

  if (cache.lastNotifiedVersion === cache.latestVersion) {
    return;
  }

  printWarn(`cli update available: ${VERSION} -> ${cache.latestVersion}`);
  printInfo(`update with: curl -fsSL ${baseUrl}/install.sh | bash`);
  logEvent("warn", "cli.update.available", {
    currentVersion: VERSION,
    latestVersion: cache.latestVersion,
    baseUrl,
  });

  cache.lastNotifiedVersion = cache.latestVersion;
  await saveUpdateCheckCache(cache).catch(() => undefined);
}

async function requireConfig() {
  const config = await loadConfig();
  if (!config) {
    throw new CliError(
      'Not authenticated. Run "ibx auth login --api-key iak_..." first.',
      { exitCode: EXIT_CODE.AUTH, code: "AUTH_REQUIRED" },
    );
  }

  return config;
}

function parseRetryAfterSeconds(value: string | null) {
  if (!value) {
    return null;
  }

  const asSeconds = Number.parseInt(value, 10);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return asSeconds;
  }

  const asDate = Date.parse(value);
  if (!Number.isFinite(asDate)) {
    return null;
  }

  const diff = Math.ceil((asDate - Date.now()) / 1000);
  return diff > 0 ? diff : null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function mapStatusToExitCode(status: number): ExitCode {
  if (status === 400 || status === 422) {
    return EXIT_CODE.VALIDATION;
  }

  if (status === 401 || status === 403) {
    return EXIT_CODE.AUTH;
  }

  if (status === 404) {
    return EXIT_CODE.NOT_FOUND;
  }

  if (status === 409) {
    return EXIT_CODE.CONFLICT;
  }

  if (status === 429) {
    return EXIT_CODE.RATE_LIMIT;
  }

  if (status >= 500) {
    return EXIT_CODE.SERVER;
  }

  return EXIT_CODE.UNKNOWN;
}

async function requestJson<T>(
  config: Pick<CliConfig, "baseUrl" | "apiKey">,
  path: string,
  init?: RequestInit,
  options?: {
    action?: string;
    retries?: number;
    timeoutMs?: number;
  },
): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const retries = options?.retries ?? (init?.method === "GET" ? DEFAULT_RETRIES : 0);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: CliError | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
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

      if (response.ok) {
        return payload;
      }

      const retryAfterSeconds = parseRetryAfterSeconds(
        response.headers.get("retry-after"),
      );
      const message =
        payload.error ||
        `Request failed (${response.status})${options?.action ? ` while ${options.action}` : ""}.`;

      const cliError = new CliError(message, {
        exitCode: mapStatusToExitCode(response.status),
        code: `HTTP_${response.status}`,
        details: {
          status: response.status,
          retryAfterSeconds,
          action: options?.action ?? null,
        },
      });

      const canRetry =
        attempt < retries &&
        (response.status === 429 || response.status >= 500);
      if (canRetry) {
        const waitMs = retryAfterSeconds
          ? Math.min(5_000, retryAfterSeconds * 1_000)
          : Math.min(3_000, 250 * 2 ** attempt);
        logEvent("warn", "http.retry", {
          target: options?.action ?? path,
          status: response.status,
          attempt: attempt + 1,
          waitMs,
        });
        await sleep(waitMs);
        continue;
      }

      throw cliError;
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "AbortError" ||
          String(error.message).toLowerCase().includes("abort"));
      const cliError =
        error instanceof CliError
          ? error
          : new CliError(
              timedOut
                ? `Request timed out after ${timeoutMs}ms${
                    options?.action ? ` while ${options.action}` : ""
                  }.`
                : `Network request failed${
                    options?.action ? ` while ${options.action}` : ""
                  }.`,
              {
                exitCode: EXIT_CODE.NETWORK,
                code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
                details: {
                  action: options?.action ?? null,
                },
              },
            );

      const canRetry = attempt < retries && cliError.exitCode === EXIT_CODE.NETWORK;
      if (canRetry) {
        const waitMs = Math.min(3_000, 200 * 2 ** attempt);
        logEvent("warn", "http.retry", {
          target: options?.action ?? path,
          code: cliError.code,
          attempt: attempt + 1,
          waitMs,
        });
        await sleep(waitMs);
        lastError = cliError;
        continue;
      }

      throw cliError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw (
    lastError ??
    new CliError("Request failed after retries.", {
      exitCode: EXIT_CODE.NETWORK,
      code: "RETRY_EXHAUSTED",
    })
  );
}

async function verifyAuth(baseUrl: string, apiKey: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), DEFAULT_TIMEOUT_MS);
  const response = await fetch(`${baseUrl}/api/session`, {
    method: "GET",
    signal: controller.signal,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": `ibx/${VERSION}`,
    },
  })
    .catch(() => null)
    .finally(() => clearTimeout(timeoutId));

  if (!response) {
    throw new CliError("Unable to reach server for auth verification.", {
      exitCode: EXIT_CODE.NETWORK,
      code: "AUTH_VERIFY_NETWORK",
    });
  }

  const payload = (await response.json().catch(() => ({}))) as {
    authenticated?: boolean;
    authType?: string;
    permission?: string;
    error?: string;
  };

  if (!response.ok) {
    throw new CliError(
      payload.error || `Auth verification failed (${response.status}).`,
      {
        exitCode: mapStatusToExitCode(response.status),
        code: `AUTH_VERIFY_${response.status}`,
      },
    );
  }

  if (!payload.authenticated) {
    throw new CliError("API key is not valid for this server.", {
      exitCode: EXIT_CODE.AUTH,
      code: "AUTH_INVALID",
    });
  }

  return payload;
}

function toStoredDateKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatDate(value: number | null) {
  if (value === null) {
    return "no date";
  }

  return toStoredDateKey(value);
}

function getDateKeyInTimezone(timestamp: number, timeZone = APP_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function getTodayDateKey() {
  return getDateKeyInTimezone(Date.now());
}

function formatTimeBlock(value: number | null) {
  if (value === null) {
    return "unscheduled";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatHoursHuman(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "unsized";
  }

  const totalMinutes = Math.round(value * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
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

    const leftStart = left.timeBlockStart ?? Number.MAX_SAFE_INTEGER;
    const rightStart = right.timeBlockStart ?? Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    return left.createdAt - right.createdAt;
  });
}

function filterTodosByView(items: TodoItem[], view: ViewMode) {
  if (view === "all") {
    return sortTodos(items);
  }

  const todayDateKey = getTodayDateKey();

  if (view === "today") {
    return sortTodos(
      items.filter(
        (todo) =>
          todo.status === "open" &&
          todo.dueDate !== null &&
          toStoredDateKey(todo.dueDate) === todayDateKey,
      ),
    );
  }

  if (view === "upcoming") {
    return sortTodos(
      items.filter(
        (todo) =>
          todo.status === "open" &&
          todo.dueDate !== null &&
          toStoredDateKey(todo.dueDate) >= todayDateKey,
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
    print(
      `  ${priorityBadge(todo.priority)} ${color.gray("//")} ${color.gray("due:")} ${formatDate(todo.dueDate)} ${color.gray("//")} ${color.gray("hours:")} ${formatHoursHuman(todo.estimatedHours)} ${color.gray("//")} ${color.gray("block:")} ${formatTimeBlock(todo.timeBlockStart)}`,
    );
    print(`  ${color.gray("id:")} ${todo.id}`);

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

function parseBooleanString(value: string | null) {
  if (value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

function resolveBooleanOption(
  parsed: ParsedArgs,
  name: string,
  defaultValue: boolean,
) {
  const positive = parsed.options[name];
  const negative = parsed.options[`no-${name}`];

  if (negative === true) {
    return false;
  }

  if (typeof positive === "string") {
    const parsedValue = parseBooleanString(positive);
    if (parsedValue === null) {
      throw new CliError(
        `--${name} must be a boolean (true/false).`,
        { exitCode: EXIT_CODE.VALIDATION, code: "INVALID_BOOLEAN_FLAG" },
      );
    }
    return parsedValue;
  }

  if (positive === true) {
    return true;
  }

  return defaultValue;
}

function parseEstimatedHours(value: string | null) {
  if (value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["null", "none", "clear"].includes(normalized)) {
    return null;
  }

  const direct = Number.parseFloat(normalized);
  if (Number.isFinite(direct)) {
    if (direct < 0.25 || direct > 24) {
      return null;
    }

    return Math.round(direct * 4) / 4;
  }

  const regex = /(?:(\d+(?:\.\d+)?)\s*h(?:ours?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?)?/;
  const match = normalized.match(regex);
  if (!match) {
    return null;
  }

  const hoursPart = match[1] ? Number.parseFloat(match[1]) : 0;
  const minutesPart = match[2] ? Number.parseFloat(match[2]) : 0;
  const total = hoursPart + minutesPart / 60;
  if (!Number.isFinite(total) || total < 0.25 || total > 24) {
    return null;
  }

  return Math.round(total * 4) / 4;
}

function getTimezoneOffsetMs(timestamp: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const second = Number(parts.find((part) => part.type === "second")?.value);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - timestamp;
}

function zonedDateTimeToUtcTimestamp(
  dateKey: string,
  hours: number,
  minutes: number,
  timeZone: string,
) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const guess = Date.UTC(year, month - 1, day, hours, minutes, 0);
  const offset = getTimezoneOffsetMs(guess, timeZone);
  let resolved = Date.UTC(year, month - 1, day, hours, minutes, 0) - offset;
  const adjustedOffset = getTimezoneOffsetMs(resolved, timeZone);
  if (adjustedOffset !== offset) {
    resolved = Date.UTC(year, month - 1, day, hours, minutes, 0) - adjustedOffset;
  }

  return Number.isFinite(resolved) ? resolved : null;
}

function parseTimeBlockStart(
  value: string | null,
  dueDate: string | null,
) {
  if (value === null) {
    return { provided: false, timeBlockStart: undefined as number | null | undefined };
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return { provided: false, timeBlockStart: undefined as number | null | undefined };
  }

  if (["none", "null", "clear", "unscheduled"].includes(normalized)) {
    return { provided: true, timeBlockStart: null };
  }

  const datePrefix = dueDate ?? getTodayDateKey();
  const timeMatch = normalized.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i);
  if (!timeMatch) {
    throw new CliError(
      "--start must be HH:mm, HH:mm am/pm, or 'clear'.",
      { exitCode: EXIT_CODE.VALIDATION, code: "INVALID_START_TIME" },
    );
  }

  let hours = Number.parseInt(timeMatch[1], 10);
  const minutes = Number.parseInt(timeMatch[2], 10);
  const meridiem = timeMatch[3]?.toLowerCase() ?? null;

  if (minutes < 0 || minutes > 59) {
    throw new CliError("--start minute must be between 00 and 59.", {
      exitCode: EXIT_CODE.VALIDATION,
      code: "INVALID_START_MINUTE",
    });
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      throw new CliError("--start hour must be 1-12 when using am/pm.", {
        exitCode: EXIT_CODE.VALIDATION,
        code: "INVALID_START_HOUR_12H",
      });
    }

    if (hours === 12) {
      hours = 0;
    }

    if (meridiem === "pm") {
      hours += 12;
    }
  } else if (hours < 0 || hours > 23) {
    throw new CliError("--start hour must be between 00 and 23.", {
      exitCode: EXIT_CODE.VALIDATION,
      code: "INVALID_START_HOUR_24H",
    });
  }

  const parsed = zonedDateTimeToUtcTimestamp(
    datePrefix,
    hours,
    minutes,
    APP_TIMEZONE,
  );
  if (parsed === null) {
    throw new CliError("Unable to parse --start time.", {
      exitCode: EXIT_CODE.VALIDATION,
      code: "INVALID_START_PARSE",
    });
  }

  return { provided: true, timeBlockStart: parsed };
}

function normalizeAuthSubcommand(value: string | null) {
  if (!value) {
    return "status";
  }

  if (value === "login" || value === "l" || value === "in") {
    return "login";
  }

  if (value === "logout" || value === "out" || value === "o") {
    return "logout";
  }

  if (value === "status" || value === "s" || value === "st") {
    return "status";
  }

  return value;
}

function normalizeTodosSubcommand(value: string | null) {
  if (!value) {
    return "list";
  }

  if (value === "list" || value === "ls" || value === "l") {
    return "list";
  }

  if (value === "done" || value === "x") {
    return "done";
  }

  if (value === "open" || value === "o") {
    return "open";
  }

  if (
    value === "delete" ||
    value === "remove" ||
    value === "del" ||
    value === "rm" ||
    value === "d"
  ) {
    return "delete";
  }

  if (value === "set" || value === "s") {
    return "set";
  }

  if (value === "run" || value === "r") {
    return "run";
  }

  if (
    value === "today-done" ||
    value === "completed-today" ||
    value === "td" ||
    value === "ct" ||
    value === "c"
  ) {
    return "today-done";
  }

  return value;
}

function normalizeCalendarSubcommand(value: string | null) {
  if (!value) {
    return "status";
  }

  if (value === "status" || value === "s" || value === "show") {
    return "status";
  }

  if (
    value === "rotate" ||
    value === "new" ||
    value === "create" ||
    value === "generate" ||
    value === "r"
  ) {
    return "rotate";
  }

  return value;
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
  print("  ibx a l [--api-key iak_...] [--url https://ibx.egeuysal.com]");
  print("  ibx auth status");
  print("  ibx a s");
  print("  ibx auth logout");
  print("  ibx a o");
  print('  ibx add [--input "..."] [--auto-schedule|--no-auto-schedule] [--include-links|--no-include-links]');
  print('          [--require-descriptions|--no-require-descriptions] [--availability-notes "..."]');
  print('  ibx n [--input "..."]');
  print("  ibx todos list [--view today|upcoming|archive|all] [--json]");
  print("  ibx t l [--view today|upcoming|archive|all] [--json]");
  print(`  ibx td   # today's completed tasks (${APP_TIMEZONE})`);
  print("  ibx calendar status");
  print("  ibx cal s");
  print("  ibx calendar rotate   # rotates ICS feed URL/token");
  print("  ibx cal r");
  print("  ibx todos done --id <todoId|prefix>");
  print("  ibx t x --id <todoId|prefix>");
  print("  ibx todos open --id <todoId|prefix>");
  print("  ibx t o --id <todoId|prefix>");
  print("  ibx todos delete --id <todoId|prefix>");
  print("  ibx t d --id <todoId|prefix>");
  print(
    "  ibx todos set --id <todoId|prefix> [--title \"new title\"] [--notes \"...\"] [--notes-null] [--due YYYY-MM-DD]",
  );
  print(
    "          [--hours 1.5|90m|1h] [--start HH:mm|HH:mm am/pm|clear] [--priority 1|2|3] [--recurrence none|daily|weekly|monthly]",
  );
  print(
    "  ibx t s --id <todoId|prefix> [--title \"new title\"] [--notes \"...\"] [--notes-null] [--due YYYY-MM-DD]",
  );
  print(
    "          [--hours 1.5|90m|1h] [--start HH:mm|HH:mm am/pm|clear] [--priority 1|2|3] [--recurrence none|daily|weekly|monthly]",
  );
  print("");
  print(color.bold("environment"));
  print(
    `  IBX_DISABLE_UPDATE_CHECK=1 ${color.gray("# disable daily CLI update checks")}`,
  );
}

async function runCalendarCommand(parsed: ParsedArgs) {
  const subcommand = normalizeCalendarSubcommand(parsed.positionals[1] ?? "status");
  const outputJson = hasFlag(parsed, "json");
  const config = await requireConfig();

  if (subcommand === "status") {
    const response = await requestJson<{
      activeFeed: {
        id: string;
        name: string;
        prefix: string;
        last4: string;
        createdAt: number;
      } | null;
    }>(
      config,
      "/api/calendar/feed-token",
      { method: "GET" },
      { action: "get calendar feed status" },
    );

    if (outputJson) {
      printJson(response);
      return;
    }

    if (!response.activeFeed) {
      printWarn("no active calendar feed token");
      printInfo("run: ibx calendar rotate");
      return;
    }

    logEvent("info", "calendar.feed.status", {
      active: true,
      last4: response.activeFeed.last4,
    });
    printOk("calendar feed token active");
    print(`${color.gray("name:")} ${response.activeFeed.name}`);
    print(`${color.gray("key:")} ${response.activeFeed.prefix}...${response.activeFeed.last4}`);
    print(
      `${color.gray("created:")} ${new Date(response.activeFeed.createdAt).toISOString()}`,
    );
    printWarn("feed URL is only shown when rotating to avoid leaking old secrets.");
    return;
  }

  if (subcommand === "rotate") {
    const response = await requestJson<{
      ok: true;
      feedUrl: string;
      feed: {
        id: string;
        name: string;
        prefix: string;
        last4: string;
        createdAt: number;
      };
    }>(
      config,
      "/api/calendar/feed-token",
      { method: "POST", body: JSON.stringify({}) },
      { action: "rotate calendar feed token" },
    );

    if (outputJson) {
      printJson(response);
      return;
    }

    logEvent("info", "calendar.feed.rotate", {
      id: response.feed.id,
      last4: response.feed.last4,
    });
    printOk("calendar feed token rotated");
    print(`${color.gray("new feed url:")} ${response.feedUrl}`);
    printWarn("keep this URL private; anyone with it can read your schedule.");
    return;
  }

  throw new CliError(`Unknown calendar subcommand: ${subcommand}`, {
    exitCode: EXIT_CODE.VALIDATION,
    code: "CALENDAR_SUBCOMMAND_INVALID",
  });
}

async function runAuthCommand(parsed: ParsedArgs) {
  const subcommand = normalizeAuthSubcommand(parsed.positionals[1] ?? "status");
  const outputJson = hasFlag(parsed, "json");

  if (subcommand === "login") {
    const apiKey =
      getStringOption(parsed, "api-key") ??
      process.env.IBX_API_KEY?.trim() ??
      null;
    const baseUrlInput = getStringOption(parsed, "url") ?? DEFAULT_BASE_URL;

    if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) {
      throw new CliError(
        "Provide a valid API key with --api-key (must start with iak_).\nexample: ibx auth login --api-key iak_... ",
        { exitCode: EXIT_CODE.VALIDATION, code: "API_KEY_INVALID" },
      );
    }

    const baseUrl = normalizeBaseUrl(baseUrlInput);
    logEvent("info", "auth.login.start", { baseUrl });
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
        permission: verification.permission ?? "both",
      });
      return;
    }

    printOk(`connected to ${baseUrl}`);
    printInfo(`auth: ${verification.authType ?? "apiKey"}`);
    printInfo(`permission: ${verification.permission ?? "both"}`);
    logEvent("info", "auth.login.done", {
      baseUrl,
      permission: verification.permission ?? "both",
    });
    return;
  }

  if (subcommand === "logout") {
    await clearConfig();
    logEvent("info", "auth.logout", {});

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
      logEvent("warn", "auth.status", { authenticated: false });
      return;
    }

    try {
      const verification = await verifyAuth(config.baseUrl, config.apiKey);
      if (outputJson) {
        printJson({
          authenticated: true,
          authType: verification.authType ?? "apiKey",
          permission: verification.permission ?? "both",
          baseUrl: config.baseUrl,
          keyHint: `${API_KEY_PREFIX}...${config.apiKey.slice(-4)}`,
        });
        return;
      }

      printOk(`authenticated (${verification.authType ?? "apiKey"})`);
      print(`${color.gray("server:")} ${config.baseUrl}`);
      print(`${color.gray("permission:")} ${verification.permission ?? "both"}`);
      print(
        `${color.gray("key:")} ${API_KEY_PREFIX}...${config.apiKey.slice(-4)}`,
      );
      logEvent("info", "auth.status", {
        authenticated: true,
        permission: verification.permission ?? "both",
      });
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
      logEvent("error", "auth.status", { authenticated: false });
      throw error;
    }
  }

  throw new CliError(`Unknown auth subcommand: ${subcommand}`, {
    exitCode: EXIT_CODE.VALIDATION,
    code: "AUTH_SUBCOMMAND_INVALID",
  });
}

async function runAddCommand(parsed: ParsedArgs) {
  const outputJson = hasFlag(parsed, "json");
  const config = await requireConfig();
  const input = await resolveAiInput(parsed);

  if (!input) {
    throw new CliError(
      'No input provided.\nexample: ibx add "finish landing page and email two leads"',
      { exitCode: EXIT_CODE.VALIDATION, code: "MISSING_INPUT" },
    );
  }
  if (input.length > 8_000) {
    throw new CliError("Input is too long (max 8000 chars).", {
      exitCode: EXIT_CODE.VALIDATION,
      code: "INPUT_TOO_LONG",
    });
  }

  if (!outputJson) {
    logEvent("info", "todo.generate.start", { inputLength: input.length });
  }

  const preferences = {
    autoSchedule: resolveBooleanOption(parsed, "auto-schedule", true),
    includeRelevantLinks: resolveBooleanOption(parsed, "include-links", true),
    requireTaskDescriptions: resolveBooleanOption(
      parsed,
      "require-descriptions",
      true,
    ),
    availabilityNotes:
      getStringOption(parsed, "availability-notes") ??
      process.env.IBX_AVAILABILITY_NOTES?.trim() ??
      null,
  };

  const response = await requestJson<{
    ok: true;
    runId: string;
    created: number;
    updated?: number;
    deleted?: number;
    droppedMutationOps?: number;
    mode?: "create" | "mutate";
    message?: string | null;
  }>(config, "/api/todos/generate", {
    method: "POST",
    body: JSON.stringify({
      text: input,
      today: getTodayDateKey(),
      preferences,
    }),
  }, {
    action: "generate todos from prompt",
  });

  if (!outputJson) {
    logEvent("info", "todo.generate.done", {
      runId: response.runId,
      created: response.created,
      updated: response.updated ?? 0,
      deleted: response.deleted ?? 0,
      droppedMutationOps: response.droppedMutationOps ?? 0,
      mode: response.mode ?? "create",
    });
  }

  if (outputJson) {
    printJson(response);
    return;
  }

  printOk(`run ${response.runId}`);
  printOk(`created ${response.created} / updated ${response.updated ?? 0} / deleted ${response.deleted ?? 0}`);
  if ((response.droppedMutationOps ?? 0) > 0) {
    printWarn(
      `ignored ${response.droppedMutationOps} mutation op(s) outside current snapshot`,
    );
  }
  if (response.message) {
    printInfo(response.message);
  }
  if (response.created === 0 && (response.updated ?? 0) === 0 && (response.deleted ?? 0) === 0) {
    printWarn(
      "ai did not apply changes (likely duplicate/no-op input)",
    );
  }
}

async function resolveTodoId(
  config: Pick<CliConfig, "baseUrl" | "apiKey">,
  idOrPrefix: string,
) {
  const candidate = idOrPrefix.trim();
  if (candidate.length < 4) {
    throw new CliError("Todo id must be full id or at least 4 characters.", {
      exitCode: EXIT_CODE.VALIDATION,
      code: "TODO_ID_TOO_SHORT",
    });
  }

  const today = getTodayDateKey();
  const response = await requestJson<{ todos: TodoItem[] }>(
    config,
    `/api/todos?today=${encodeURIComponent(today)}`,
    {
      method: "GET",
    },
    { action: "fetch todos for id resolution" },
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
    throw new CliError(`No todo matches "${candidate}".`, {
      exitCode: EXIT_CODE.NOT_FOUND,
      code: "TODO_NOT_FOUND",
    });
  }

  throw new CliError(
    `Ambiguous todo id prefix "${candidate}" (${prefixMatches.length} matches). Use more characters or full id.`,
    { exitCode: EXIT_CODE.CONFLICT, code: "TODO_ID_AMBIGUOUS" },
  );
}

async function runTodosCommand(parsed: ParsedArgs) {
  const subcommand = normalizeTodosSubcommand(parsed.positionals[1] ?? "list");
  const outputJson = hasFlag(parsed, "json");
  const config = await requireConfig();

  if (subcommand === "list") {
    const view = parseView(getStringOption(parsed, "view"));
    const today = getTodayDateKey();
    const response = await requestJson<{ todos: TodoItem[] }>(
      config,
      `/api/todos?today=${encodeURIComponent(today)}`,
      {
        method: "GET",
      },
      { action: "list todos" },
    );

    const filtered = filterTodosByView(response.todos, view);

    if (outputJson) {
      printJson({ view, todos: filtered });
      return;
    }

    logEvent("info", "todos.list", { view, count: filtered.length });
    print(`${color.bold(view)} ${color.gray(String(filtered.length))}`);
    printTodoList(filtered, view);
    return;
  }

  if (subcommand === "today-done") {
    const todayDateKey = getTodayDateKey();
    const today = getTodayDateKey();
    const response = await requestJson<{ todos: TodoItem[] }>(
      config,
      `/api/todos?today=${encodeURIComponent(today)}`,
      {
        method: "GET",
      },
      { action: "list today done todos" },
    );

    const filtered = sortTodos(
      response.todos.filter(
        (todo) =>
          todo.status === "done" &&
          todo.dueDate !== null &&
          toStoredDateKey(todo.dueDate) === todayDateKey,
      ),
    );

    if (outputJson) {
      printJson({ view: "today-done", todos: filtered });
      return;
    }

    logEvent("info", "todos.today_done", { count: filtered.length });
    print(`${color.bold("today-done")} ${color.gray(String(filtered.length))}`);
    printTodoList(filtered, "archive");
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
      throw new CliError("Provide todo id with --id.", {
        exitCode: EXIT_CODE.VALIDATION,
        code: "TODO_ID_REQUIRED",
      });
    }
    const todoId = await resolveTodoId(config, todoIdInput);

    await requestJson<{ ok: true }>(config, `/api/todos/${todoId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: subcommand === "done" ? "done" : "open" }),
    }, { action: `mark todo ${subcommand}` });

    if (outputJson) {
      printJson({ ok: true, id: todoId, status: subcommand });
      return;
    }

    logEvent("info", "todos.status", { id: todoId, status: subcommand });
    printOk(`${subcommand} ${todoId}`);
    return;
  }

  if (subcommand === "delete" || subcommand === "remove") {
    const todoIdInput =
      getStringOption(parsed, "id") ?? parsed.positionals[2] ?? null;
    if (!todoIdInput) {
      throw new CliError("Provide todo id with --id.", {
        exitCode: EXIT_CODE.VALIDATION,
        code: "TODO_ID_REQUIRED",
      });
    }
    const todoId = await resolveTodoId(config, todoIdInput);

    await requestJson<{ ok: true }>(config, `/api/todos/${todoId}`, {
      method: "DELETE",
    }, { action: "delete todo" });

    if (outputJson) {
      printJson({ ok: true, id: todoId, status: "deleted" });
      return;
    }

    logEvent("info", "todos.delete", { id: todoId });
    printOk(`deleted ${todoId}`);
    return;
  }

  if (subcommand === "set") {
    const todoIdInput =
      getStringOption(parsed, "id") ?? parsed.positionals[2] ?? null;
    if (!todoIdInput) {
      throw new CliError("Provide todo id with --id.", {
        exitCode: EXIT_CODE.VALIDATION,
        code: "TODO_ID_REQUIRED",
      });
    }
    const todoId = await resolveTodoId(config, todoIdInput);

    const due = getStringOption(parsed, "due");
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      throw new CliError("--due must be in YYYY-MM-DD format.", {
        exitCode: EXIT_CODE.VALIDATION,
        code: "DUE_DATE_INVALID",
      });
    }

    const recurrence = parseRecurrence(getStringOption(parsed, "recurrence"));
    if (getStringOption(parsed, "recurrence") && !recurrence) {
      throw new CliError(
        "--recurrence must be one of: none, daily, weekly, monthly.",
        { exitCode: EXIT_CODE.VALIDATION, code: "RECURRENCE_INVALID" },
      );
    }

    const priority = parsePriority(getStringOption(parsed, "priority"));
    if (getStringOption(parsed, "priority") && !priority) {
      throw new CliError("--priority must be one of: 1, 2, 3.", {
        exitCode: EXIT_CODE.VALIDATION,
        code: "PRIORITY_INVALID",
      });
    }

    const titleInput = getStringOption(parsed, "title");
    const title =
      titleInput !== null ? titleInput.trim().slice(0, 140) : null;
    if (titleInput !== null && !title) {
      throw new CliError("--title cannot be empty.", {
        exitCode: EXIT_CODE.VALIDATION,
        code: "TITLE_INVALID",
      });
    }

    const notesNull = hasFlag(parsed, "notes-null");
    const notesInput = getStringOption(parsed, "notes");
    const notes =
      notesNull
        ? null
        : notesInput !== null
          ? notesInput.trim().slice(0, 640) || null
          : undefined;

    const hoursRaw = getStringOption(parsed, "hours");
    const hours = parseEstimatedHours(hoursRaw);
    if (hoursRaw !== null && hours === null && !["null", "none", "clear"].includes(hoursRaw.trim().toLowerCase())) {
      throw new CliError("--hours must be a number or duration (e.g. 1.5, 90m, 1h 30m, clear).", {
        exitCode: EXIT_CODE.VALIDATION,
        code: "HOURS_INVALID",
      });
    }

    const startRaw = getStringOption(parsed, "start");
    const startParsed = parseTimeBlockStart(startRaw, due);

    const payload: {
      dueDate?: string | null;
      recurrence?: TodoRecurrence;
      priority?: TodoPriority;
      title?: string;
      notes?: string | null;
      estimatedHours?: number | null;
      timeBlockStart?: number | null;
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

    if (notes !== undefined) {
      payload.notes = notes;
    }

    if (hoursRaw !== null) {
      payload.estimatedHours = hours;
    }

    if (startParsed.provided) {
      payload.timeBlockStart = startParsed.timeBlockStart ?? null;
    }

    if (Object.keys(payload).length === 0) {
      throw new CliError(
        "Nothing to update. Set at least one of --title, --notes, --due, --start, --hours, --recurrence, --priority.",
        { exitCode: EXIT_CODE.VALIDATION, code: "SET_EMPTY" },
      );
    }

    await requestJson<{ ok: true }>(config, `/api/todos/${todoId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }, { action: "update todo fields" });

    if (outputJson) {
      printJson({ ok: true, id: todoId, ...payload });
      return;
    }

    logEvent("info", "todos.set", { id: todoId, fields: Object.keys(payload) });
    printOk(`updated ${todoId}`);
    return;
  }

  throw new CliError(`Unknown todos subcommand: ${subcommand}`, {
    exitCode: EXIT_CODE.VALIDATION,
    code: "TODOS_SUBCOMMAND_INVALID",
  });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const first = parsed.positionals[0];
  const normalizedFirst =
    first === "a"
      ? "auth"
      : first === "n"
        ? "add"
        : first === "t"
          ? "todos"
          : first === "cal" || first === "c"
            ? "calendar"
          : first === "td"
            ? "todos"
            : first;
  const normalizedParsed: ParsedArgs =
    first === "td"
      ? {
          ...parsed,
          positionals: ["todos", "today-done", ...parsed.positionals.slice(1)],
        }
      : first === "a" || first === "n" || first === "t" || first === "cal" || first === "c"
        ? {
            ...parsed,
            positionals: [normalizedFirst as string, ...parsed.positionals.slice(1)],
          }
        : parsed;

  if (hasFlag(parsed, "help") || normalizedFirst === "help") {
    printHelp();
    return;
  }

  if (hasFlag(parsed, "version") || normalizedFirst === "version") {
    print(VERSION);
    return;
  }

  if (!normalizedFirst) {
    await checkForCliUpdates(normalizedFirst, normalizedParsed);
    print(`${color.bold("ibx")} ${color.gray("quick capture")}`);
    await runAddCommand({
      ...normalizedParsed,
      positionals: ["add"],
    });
    return;
  }

  await checkForCliUpdates(normalizedFirst, normalizedParsed);

  if (normalizedFirst === "auth") {
    await runAuthCommand(normalizedParsed);
    return;
  }

  if (normalizedFirst === "add") {
    await runAddCommand(normalizedParsed);
    return;
  }

  if (normalizedFirst === "todos") {
    await runTodosCommand(normalizedParsed);
    return;
  }

  if (normalizedFirst === "calendar") {
    await runCalendarCommand(normalizedParsed);
    return;
  }

  throw new CliError(`Unknown command: ${normalizedFirst}`, {
    exitCode: EXIT_CODE.VALIDATION,
    code: "COMMAND_INVALID",
  });
}

void main().catch((error) => {
  if (isInterruptedError(error)) {
    logEvent("info", "cli.interrupted");
    process.stderr.write("\n");
    process.exitCode = 130;
    return;
  }

  const cliError =
    error instanceof CliError
      ? error
      : new CliError(error instanceof Error ? error.message : String(error), {
          exitCode: EXIT_CODE.UNKNOWN,
          code: "UNHANDLED",
        });
  logEvent("error", "cli.failure", {
    code: cliError.code,
    exitCode: cliError.exitCode,
    ...(cliError.details ?? {}),
  });
  printError(cliError.message);
  process.exitCode = cliError.exitCode;
});
