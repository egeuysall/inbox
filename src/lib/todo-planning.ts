import type { GeneratedTodo } from "@/lib/ai";

const MAX_TODOS_PER_RUN = 30;
const META_TITLE_REGEX = /^(plan|outline|brainstorm|think through)\b/i;
const HOW_TO_REGEX = /\bhow to\b/i;
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "for",
  "of",
  "and",
  "or",
  "in",
  "on",
  "with",
  "my",
  "your",
  "this",
  "that",
]);
const USER_TIMEZONE = "America/Chicago";
const DEFAULT_EXECUTION_SPEED_MULTIPLIER = 4;
const END_OF_DAY_CUTOFF_MINUTES = 22 * 60 + 30;
const TZ_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: USER_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export type ExistingTodoForPlanning = {
  id: string;
  title: string;
  notes: string | null;
  status: "open" | "done";
  dueDate?: number | null;
  estimatedHours?: number | null;
  timeBlockStart?: number | null;
  priority?: 1 | 2 | 3 | null;
  recurrence?: "none" | "daily" | "weekly" | "monthly" | null;
  createdAt: number;
};

export type PlannedTodo = GeneratedTodo & {
  dueDateTimestamp: number;
  notes: string | null;
  estimatedHours: number;
  timeBlockStart: number | null;
};

export type PlannedTodoUpdate = {
  id: string;
  title: string;
  notes: string | null;
  dueDateTimestamp: number;
  estimatedHours: number;
  timeBlockStart: number | null;
  priority: 1 | 2 | 3;
  recurrence: "none" | "daily" | "weekly" | "monthly";
};

export type TodoReconciliationPlan = {
  create: PlannedTodo[];
  update: PlannedTodoUpdate[];
  deleteIds: string[];
};

type ReconciliationOptions = {
  autoSchedule?: boolean;
  requireTaskDescriptions?: boolean;
};

export type TimeBlockScheduleCandidate = {
  key: string;
  existingTodoId?: string;
  status?: "open" | "done";
  dueDateTimestamp?: number | null;
  estimatedHours?: number | null;
  priority?: 1 | 2 | 3 | null;
  timeBlockStart?: number | null;
};

type TimeBlockScheduleOptions = {
  todayStartUtc?: number;
  allowOutsideAvailability?: boolean;
};

function getStartOfUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseDueDateToTimestamp(dueDate: string | null) {
  if (!dueDate) {
    return null;
  }

  const parsed = Date.parse(`${dueDate}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTitleText(title: string) {
  return title.replace(/\s+/g, " ").trim().slice(0, 140);
}

function normalizeTitleKey(title: string) {
  return normalizeTitleText(title)
    .toLocaleLowerCase()
    .replace(/['"`’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizePriority(priority: number | null | undefined): 1 | 2 | 3 {
  if (priority === 1 || priority === 3) {
    return priority;
  }

  return 2;
}

function normalizeRecurrence(
  recurrence: string | null | undefined,
): "none" | "daily" | "weekly" | "monthly" {
  if (
    recurrence === "daily" ||
    recurrence === "weekly" ||
    recurrence === "monthly"
  ) {
    return recurrence;
  }

  return "none";
}

function normalizeEstimatedHours(hours: number | null | undefined) {
  if (typeof hours !== "number" || !Number.isFinite(hours)) {
    return null;
  }

  if (hours < 0.25 || hours > 24) {
    return null;
  }

  return Math.round(hours * 4) / 4;
}

function defaultEstimatedHoursForPriority(priority: 1 | 2 | 3) {
  if (priority === 1) {
    return 2.5;
  }

  if (priority === 2) {
    return 1.5;
  }

  return 1;
}

function applyExecutionSpeedMultiplier(hours: number, executionSpeedMultiplier = DEFAULT_EXECUTION_SPEED_MULTIPLIER) {
  const normalizedMultiplier =
    Number.isFinite(executionSpeedMultiplier) && executionSpeedMultiplier > 0
      ? executionSpeedMultiplier
      : DEFAULT_EXECUTION_SPEED_MULTIPLIER;
  return Math.max(0.25, Math.round((hours / normalizedMultiplier) * 4) / 4);
}

function applyExecutionSpeedMultiplierWithMinimum(
  hours: number,
  executionSpeedMultiplier = DEFAULT_EXECUTION_SPEED_MULTIPLIER,
  minHours = 0.25,
) {
  return Math.max(
    minHours,
    applyExecutionSpeedMultiplier(hours, executionSpeedMultiplier),
  );
}

function parseExplicitDurationFromText(text: string) {
  const compactMatch = text.match(/\b(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2})\s*m)?\b/);
  if (compactMatch) {
    const hours = Number(compactMatch[1]);
    const minutes = compactMatch[2] ? Number(compactMatch[2]) : 0;
    const total = hours + minutes / 60;
    return normalizeEstimatedHours(total);
  }

  const hoursMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs)\b/);
  const minutesMatch = text.match(/\b(\d{1,3})\s*(minute|minutes|min|mins|m)\b/);
  if (!hoursMatch && !minutesMatch) {
    return null;
  }

  const total =
    (hoursMatch ? Number(hoursMatch[1]) : 0) +
    (minutesMatch ? Number(minutesMatch[1]) / 60 : 0);
  return normalizeEstimatedHours(total);
}

function inferEstimatedHoursForTask(
  title: string,
  notes: string | null | undefined,
  priority: 1 | 2 | 3,
  executionSpeedMultiplier = DEFAULT_EXECUTION_SPEED_MULTIPLIER,
) {
  const normalized = `${title} ${notes ?? ""}`.toLowerCase();
  const explicitDuration = parseExplicitDurationFromText(normalized);
  if (explicitDuration) {
    return explicitDuration;
  }

  if (
    /\b(ryva|gtm|outreach|campaign|implement|build|code|coding|refactor|debug|diagnos|investigat|architect|feature|api|database|schema|migration|integration|performance|security|research|analysis|draft|write|spec|proposal)\b/.test(
      normalized,
    )
  ) {
    const baseHoursByPriority: Record<1 | 2 | 3, number> = {
      1: 4,
      2: 3,
      3: 2,
    };
    return applyExecutionSpeedMultiplierWithMinimum(
      baseHoursByPriority[priority],
      executionSpeedMultiplier,
      0.75,
    );
  }

  if (
    /\b(math|homework|study|practice|review|prep|analy|read|watch|learn)\b/.test(
      normalized,
    )
  ) {
    const baseHoursByPriority: Record<1 | 2 | 3, number> = {
      1: 2.5,
      2: 2,
      3: 1.5,
    };
    return applyExecutionSpeedMultiplierWithMinimum(
      baseHoursByPriority[priority],
      executionSpeedMultiplier,
      0.5,
    );
  }

  if (
    /\b(email|reply|message|text|dm|ping|confirm|submit|upload|copy|paste|bookmark|quick|minor|small|tiny|15m|15 min)\b/.test(
      normalized,
    )
  ) {
    const baseHoursByPriority: Record<1 | 2 | 3, number> = {
      1: 1,
      2: 0.75,
      3: 0.5,
    };
    return applyExecutionSpeedMultiplierWithMinimum(
      baseHoursByPriority[priority],
      executionSpeedMultiplier,
      0.25,
    );
  }

  return applyExecutionSpeedMultiplierWithMinimum(
    defaultEstimatedHoursForPriority(priority),
    executionSpeedMultiplier,
    0.5,
  );
}

function sanitizeNotes(notes: string | null | undefined) {
  if (typeof notes !== "string") {
    return null;
  }

  const cleaned = notes
    .replace(/\bcontext:\s*/gi, "")
    .replace(/\bnext:\s*/gi, "")
    .replace(/\s*;\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  return cleaned || null;
}

function fallbackNotesFromTitle(title: string) {
  const cleanedTitle = normalizeTitleText(title).replace(/[.!?]+$/g, "");
  if (!cleanedTitle) {
    return "Complete this task.";
  }

  return `Complete ${cleanedTitle}.`;
}

function ensureNotesDescription(title: string, notes: string | null | undefined) {
  return sanitizeNotes(notes) ?? fallbackNotesFromTitle(title);
}

function normalizeNotesForPreference(
  title: string,
  notes: string | null | undefined,
  requireTaskDescriptions: boolean,
) {
  if (requireTaskDescriptions) {
    return ensureNotesDescription(title, notes);
  }

  return sanitizeNotes(notes);
}

function getTimezoneOffsetAt(timestamp: number, formatter: Intl.DateTimeFormat) {
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

function getDateKeyInTimezone(timestamp: number, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

function getHourMinuteInTimezone(timestamp: number, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  return { hour, minute };
}

function zonedDateTimeToUtcTimestamp(dateKey: string, minutesSinceStart: number) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(minutesSinceStart)
  ) {
    return null;
  }

  const hours = Math.floor(minutesSinceStart / 60);
  const minutes = minutesSinceStart % 60;
  const guess = Date.UTC(year, month - 1, day, hours, minutes, 0);
  const offset = getTimezoneOffsetAt(guess, TZ_PARTS_FORMATTER);
  let resolved = Date.UTC(year, month - 1, day, hours, minutes, 0) - offset;
  const adjustedOffset = getTimezoneOffsetAt(resolved, TZ_PARTS_FORMATTER);
  if (adjustedOffset !== offset) {
    resolved = Date.UTC(year, month - 1, day, hours, minutes, 0) - adjustedOffset;
  }

  return Number.isFinite(resolved) ? resolved : null;
}

function getAvailabilityWindows(dateKey: string): Array<[number, number]> {
  const dayOfWeek = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();

  // Mon-Tue unavailable before 6:00 PM.
  if (dayOfWeek === 1 || dayOfWeek === 2) {
    return [[18 * 60, END_OF_DAY_CUTOFF_MINUTES]];
  }

  // Wed-Fri unavailable before 5:00 PM.
  if (dayOfWeek >= 3 && dayOfWeek <= 5) {
    return [[17 * 60, END_OF_DAY_CUTOFF_MINUTES]];
  }

  // Saturday fully available.
  if (dayOfWeek === 6) {
    return [[0, END_OF_DAY_CUTOFF_MINUTES]];
  }

  // Sunday fully available except 11:00 AM-12:00 PM and 7:00-8:00 PM.
  return [
    [0, 11 * 60],
    [12 * 60, 19 * 60],
    [20 * 60, END_OF_DAY_CUTOFF_MINUTES],
  ];
}

function isIntervalWithinAvailability(
  dateKey: string,
  startMinutes: number,
  durationMinutes: number,
) {
  if (startMinutes < 0 || startMinutes + durationMinutes > 24 * 60) {
    return false;
  }

  const windows = getAvailabilityWindows(dateKey);
  return windows.some(
    ([windowStart, windowEnd]) =>
      startMinutes >= windowStart &&
      startMinutes + durationMinutes <= windowEnd,
  );
}

function intervalsOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function suggestTimeBlockStart(
  dateKey: string,
  estimatedHours: number,
  busyByDateKey: Map<string, Array<[number, number]>>,
) {
  const durationMinutes = Math.max(15, Math.round(estimatedHours * 60 / 15) * 15);
  const windows = getAvailabilityWindows(dateKey);
  const busy = busyByDateKey.get(dateKey) ?? [];

  for (const [windowStart, windowEnd] of windows) {
    if (windowStart + durationMinutes > windowEnd) {
      continue;
    }

    for (
      let cursor = windowStart;
      cursor + durationMinutes <= windowEnd;
      cursor += 15
    ) {
      const overlaps = busy.some(([busyStart, busyEnd]) =>
        intervalsOverlap(cursor, cursor + durationMinutes, busyStart, busyEnd),
      );
      if (overlaps) {
        continue;
      }

      return cursor;
    }
  }

  return null;
}

function addBusyInterval(
  busyByDateKey: Map<string, Array<[number, number]>>,
  dateKey: string,
  startMinutes: number,
  estimatedHours: number,
) {
  const durationMinutes = Math.max(15, Math.round(estimatedHours * 60 / 15) * 15);
  const bucket = busyByDateKey.get(dateKey) ?? [];
  bucket.push([startMinutes, startMinutes + durationMinutes]);
  busyByDateKey.set(dateKey, bucket);
}

function isMetaTaskTitle(title: string) {
  const normalized = normalizeTitleText(title);
  return META_TITLE_REGEX.test(normalized) || HOW_TO_REGEX.test(normalized);
}

function tokenizeTitle(title: string) {
  return normalizeTitleKey(title)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function titleSimilarity(left: string, right: string) {
  const leftTokens = tokenizeTitle(left);
  const rightTokens = tokenizeTitle(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  let overlap = 0;

  for (const token of leftTokens) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

function normalizePlannedTodo(
  todo: GeneratedTodo,
  todayStartUtc: number,
  requireTaskDescriptions: boolean,
): PlannedTodo {
  const parsedDueDate = parseDueDateToTimestamp(todo.dueDate);
  const dueDateTimestamp =
    parsedDueDate !== null && parsedDueDate > todayStartUtc
      ? parsedDueDate
      : todayStartUtc;
  const priority = normalizePriority(todo.priority);
  const estimatedHours =
    normalizeEstimatedHours(todo.estimatedHours) ??
    inferEstimatedHoursForTask(todo.title, todo.notes, priority);
  const timeBlockStart =
    typeof todo.timeBlockStart === "number" && Number.isFinite(todo.timeBlockStart)
      ? todo.timeBlockStart
      : null;

  return {
    ...todo,
    title: normalizeTitleText(todo.title),
    notes: normalizeNotesForPreference(
      todo.title,
      todo.notes,
      requireTaskDescriptions,
    ),
    priority,
    estimatedHours,
    timeBlockStart,
    recurrence: normalizeRecurrence(todo.recurrence),
    dueDateTimestamp,
  };
}

function needsUpdate(
  existingTodo: ExistingTodoForPlanning,
  nextTodo: PlannedTodo | PlannedTodoUpdate,
) {
  const existingTitle = normalizeTitleText(existingTodo.title);
  const existingNotes = sanitizeNotes(existingTodo.notes);
  const existingPriority = normalizePriority(existingTodo.priority);
  const existingRecurrence = normalizeRecurrence(existingTodo.recurrence);
  const existingDueDate =
    typeof existingTodo.dueDate === "number" ? existingTodo.dueDate : null;
  const existingEstimatedHours =
    normalizeEstimatedHours(existingTodo.estimatedHours) ??
    defaultEstimatedHoursForPriority(existingPriority);
  const existingTimeBlockStart =
    typeof existingTodo.timeBlockStart === "number" &&
    Number.isFinite(existingTodo.timeBlockStart)
      ? existingTodo.timeBlockStart
      : null;

  return (
    existingTitle !== nextTodo.title ||
    existingNotes !== nextTodo.notes ||
    existingPriority !== nextTodo.priority ||
    existingRecurrence !== nextTodo.recurrence ||
    existingDueDate !== nextTodo.dueDateTimestamp ||
    existingEstimatedHours !== nextTodo.estimatedHours ||
    existingTimeBlockStart !== nextTodo.timeBlockStart
  );
}

export function planTodoReconciliation(
  generatedTodos: GeneratedTodo[],
  existingTodos: ExistingTodoForPlanning[],
  now = Date.now(),
  options: ReconciliationOptions = {},
): TodoReconciliationPlan {
  const autoSchedule = options.autoSchedule ?? true;
  const requireTaskDescriptions = options.requireTaskDescriptions ?? true;
  const todayStartUtc = getStartOfUtcDay(now);
  const create: PlannedTodo[] = [];
  const update: PlannedTodoUpdate[] = [];
  const deleteIds: string[] = [];

  const openTodos = existingTodos
    .filter((todo) => todo.status === "open")
    .map((todo) => ({ ...todo, title: normalizeTitleText(todo.title) }));

  // Deduplicate existing open todos by normalized title key.
  const openByKey = new Map<string, ExistingTodoForPlanning[]>();
  for (const todo of openTodos) {
    const key = normalizeTitleKey(todo.title);
    if (!key) {
      continue;
    }

    const bucket = openByKey.get(key) ?? [];
    bucket.push(todo);
    openByKey.set(key, bucket);
  }

  const keptOpenTodos: ExistingTodoForPlanning[] = [];
  for (const bucket of openByKey.values()) {
    bucket.sort((left, right) => right.createdAt - left.createdAt);
    const [keep, ...duplicates] = bucket;
    if (keep) {
      keptOpenTodos.push(keep);
    }

    for (const duplicate of duplicates) {
      deleteIds.push(duplicate.id);
    }
  }

  // Clean up existing task copy/readability even if no generated collision.
  for (const todo of keptOpenTodos) {
    const normalizedPriority = normalizePriority(todo.priority);
    const normalizedEstimatedHours =
      normalizeEstimatedHours(todo.estimatedHours) ??
      inferEstimatedHoursForTask(todo.title, todo.notes, normalizedPriority);
    const normalizedTimeBlockStart =
      typeof todo.timeBlockStart === "number" && Number.isFinite(todo.timeBlockStart)
        ? todo.timeBlockStart
        : null;

    const cleaned: PlannedTodoUpdate = {
      id: todo.id,
      title: normalizeTitleText(todo.title),
      notes: normalizeNotesForPreference(
        todo.title,
        todo.notes,
        requireTaskDescriptions,
      ),
      dueDateTimestamp:
        typeof todo.dueDate === "number" ? todo.dueDate : todayStartUtc,
      estimatedHours: normalizedEstimatedHours,
      timeBlockStart: normalizedTimeBlockStart,
      priority: normalizedPriority,
      recurrence: normalizeRecurrence(todo.recurrence),
    };

    if (needsUpdate(todo, cleaned)) {
      update.push(cleaned);
    }
  }

  const generatedUnique = generatedTodos
    .map((todo, index) => ({ todo, index }))
    .filter(({ todo }) => !isMetaTaskTitle(todo.title))
    .sort((left, right) => {
      if (left.todo.priority !== right.todo.priority) {
        return left.todo.priority - right.todo.priority;
      }

      return left.index - right.index;
    })
    .slice(0, MAX_TODOS_PER_RUN)
    .map(({ todo }) =>
      normalizePlannedTodo(todo, todayStartUtc, requireTaskDescriptions),
    );

  const busyByDateKey = new Map<string, Array<[number, number]>>();
  for (const todo of keptOpenTodos) {
    if (
      typeof todo.timeBlockStart !== "number" ||
      !Number.isFinite(todo.timeBlockStart)
    ) {
      continue;
    }

    const dateKey = getDateKeyInTimezone(todo.timeBlockStart, TZ_PARTS_FORMATTER);
    const hourMinute = getHourMinuteInTimezone(todo.timeBlockStart, TZ_PARTS_FORMATTER);
    if (!dateKey || !hourMinute) {
      continue;
    }

    const estimatedHours =
      normalizeEstimatedHours(todo.estimatedHours) ??
      inferEstimatedHoursForTask(
        todo.title,
        todo.notes,
        normalizePriority(todo.priority),
      );
    const startMinutes = hourMinute.hour * 60 + hourMinute.minute;
    addBusyInterval(busyByDateKey, dateKey, startMinutes, estimatedHours);
  }

  const scheduledGenerated = !autoSchedule
    ? generatedUnique
    : generatedUnique.map((todo) => {
    const durationMinutes = Math.max(
      15,
      Math.round((todo.estimatedHours * 60) / 15) * 15,
    );

    if (typeof todo.timeBlockStart === "number" && Number.isFinite(todo.timeBlockStart)) {
      const dateKey = getDateKeyInTimezone(todo.timeBlockStart, TZ_PARTS_FORMATTER);
      const hourMinute = getHourMinuteInTimezone(todo.timeBlockStart, TZ_PARTS_FORMATTER);
      if (dateKey && hourMinute) {
        const startMinutes = hourMinute.hour * 60 + hourMinute.minute;
        const busy = busyByDateKey.get(dateKey) ?? [];
        const overlaps = busy.some(([busyStart, busyEnd]) =>
          intervalsOverlap(
            startMinutes,
            startMinutes + durationMinutes,
            busyStart,
            busyEnd,
          ),
        );
        if (
          isIntervalWithinAvailability(dateKey, startMinutes, durationMinutes) &&
          !overlaps
        ) {
          addBusyInterval(
            busyByDateKey,
            dateKey,
            startMinutes,
            todo.estimatedHours,
          );
          return todo;
        }
      }
    }

    const dateKey = new Date(todo.dueDateTimestamp).toISOString().slice(0, 10);
    const suggestedStartMinutes = suggestTimeBlockStart(
      dateKey,
      todo.estimatedHours,
      busyByDateKey,
    );
    if (suggestedStartMinutes === null) {
      return todo;
    }

    const suggestedTimestamp = zonedDateTimeToUtcTimestamp(dateKey, suggestedStartMinutes);
    if (suggestedTimestamp === null) {
      return todo;
    }

    addBusyInterval(
      busyByDateKey,
      dateKey,
      suggestedStartMinutes,
      todo.estimatedHours,
    );

    return {
      ...todo,
      timeBlockStart: suggestedTimestamp,
    };
  });

  const seenGeneratedKeys = new Set<string>();
  for (const generatedTodo of scheduledGenerated) {
    const key = normalizeTitleKey(generatedTodo.title);
    if (!key || seenGeneratedKeys.has(key)) {
      continue;
    }
    seenGeneratedKeys.add(key);

    let matchedTodo: ExistingTodoForPlanning | null =
      keptOpenTodos.find((todo) => normalizeTitleKey(todo.title) === key) ?? null;

    if (!matchedTodo) {
      matchedTodo =
        keptOpenTodos.find((todo) => titleSimilarity(todo.title, generatedTodo.title) >= 0.75) ??
        null;
    }

    if (!matchedTodo) {
      create.push(generatedTodo);
      continue;
    }

    const nextUpdate: PlannedTodoUpdate = {
      id: matchedTodo.id,
      title: generatedTodo.title,
      notes: generatedTodo.notes,
      dueDateTimestamp: generatedTodo.dueDateTimestamp,
      estimatedHours: generatedTodo.estimatedHours,
      timeBlockStart: generatedTodo.timeBlockStart,
      priority: generatedTodo.priority,
      recurrence: generatedTodo.recurrence,
    };

    if (needsUpdate(matchedTodo, nextUpdate)) {
      // Remove existing formatting-only update for this id if we have a better agent update now.
      const existingUpdateIndex = update.findIndex((item) => item.id === matchedTodo.id);
      if (existingUpdateIndex !== -1) {
        update.splice(existingUpdateIndex, 1, nextUpdate);
      } else {
        update.push(nextUpdate);
      }
    }
  }

  return {
    create,
    update,
    deleteIds,
  };
}

export function resolveNonOverlappingTimeBlocks(
  existingTodos: ExistingTodoForPlanning[],
  candidates: TimeBlockScheduleCandidate[],
  options: TimeBlockScheduleOptions = {},
) {
  const todayStartUtc =
    typeof options.todayStartUtc === "number" && Number.isFinite(options.todayStartUtc)
      ? options.todayStartUtc
      : getStartOfUtcDay(Date.now());
  const allowOutsideAvailability = options.allowOutsideAvailability ?? false;
  const results = new Map<string, number | null>();

  const candidateTodoIds = new Set(
    candidates
      .map((candidate) =>
        typeof candidate.existingTodoId === "string"
          ? candidate.existingTodoId
          : null,
      )
      .filter((value): value is string => value !== null),
  );

  const busyByDateKey = new Map<string, Array<[number, number]>>();
  for (const todo of existingTodos) {
    if (todo.status !== "open") {
      continue;
    }

    if (candidateTodoIds.has(todo.id)) {
      continue;
    }

    if (
      typeof todo.timeBlockStart !== "number" ||
      !Number.isFinite(todo.timeBlockStart)
    ) {
      continue;
    }

    const dateKey = getDateKeyInTimezone(todo.timeBlockStart, TZ_PARTS_FORMATTER);
    const hourMinute = getHourMinuteInTimezone(todo.timeBlockStart, TZ_PARTS_FORMATTER);
    if (!dateKey || !hourMinute) {
      continue;
    }

    const estimatedHours =
      normalizeEstimatedHours(todo.estimatedHours) ??
      inferEstimatedHoursForTask(
        todo.title,
        todo.notes,
        normalizePriority(todo.priority),
      );
    addBusyInterval(
      busyByDateKey,
      dateKey,
      hourMinute.hour * 60 + hourMinute.minute,
      estimatedHours,
    );
  }

  const normalizedCandidates = candidates
    .map((candidate, index) => {
      const status = candidate.status ?? "open";
      if (status !== "open") {
        return null;
      }

      const priority = normalizePriority(candidate.priority);
      const estimatedHours =
        normalizeEstimatedHours(candidate.estimatedHours) ??
        applyExecutionSpeedMultiplier(defaultEstimatedHoursForPriority(priority));
      const dueDateTimestamp =
        typeof candidate.dueDateTimestamp === "number" &&
        Number.isFinite(candidate.dueDateTimestamp)
          ? candidate.dueDateTimestamp
          : todayStartUtc;
      const normalizedTimeBlockStart =
        typeof candidate.timeBlockStart === "number" &&
        Number.isFinite(candidate.timeBlockStart)
          ? candidate.timeBlockStart
          : null;

      return {
        candidate,
        index,
        priority,
        estimatedHours,
        dueDateTimestamp,
        normalizedTimeBlockStart,
      };
    })
    .filter(
      (
        value,
      ): value is {
        candidate: TimeBlockScheduleCandidate;
        index: number;
        priority: 1 | 2 | 3;
        estimatedHours: number;
        dueDateTimestamp: number;
        normalizedTimeBlockStart: number | null;
      } => value !== null,
    )
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      if (left.dueDateTimestamp !== right.dueDateTimestamp) {
        return left.dueDateTimestamp - right.dueDateTimestamp;
      }

      return left.index - right.index;
    });

  for (const item of normalizedCandidates) {
    const desiredDateKey = new Date(item.dueDateTimestamp).toISOString().slice(0, 10);
    const durationMinutes = Math.max(
      15,
      Math.round((item.estimatedHours * 60) / 15) * 15,
    );

    let resolvedTimestamp: number | null = null;

    if (item.normalizedTimeBlockStart !== null) {
      const explicitDateKey = getDateKeyInTimezone(
        item.normalizedTimeBlockStart,
        TZ_PARTS_FORMATTER,
      );
      const explicitHourMinute = getHourMinuteInTimezone(
        item.normalizedTimeBlockStart,
        TZ_PARTS_FORMATTER,
      );
      if (explicitDateKey && explicitHourMinute) {
        const explicitStartMinutes =
          explicitHourMinute.hour * 60 + explicitHourMinute.minute;
        const explicitEndsToday = explicitStartMinutes + durationMinutes <= 24 * 60;
        const explicitWithinAvailability =
          allowOutsideAvailability ||
          isIntervalWithinAvailability(
            explicitDateKey,
            explicitStartMinutes,
            durationMinutes,
          );
        const explicitBusy = busyByDateKey.get(explicitDateKey) ?? [];
        const overlaps = explicitBusy.some(([busyStart, busyEnd]) =>
          intervalsOverlap(
            explicitStartMinutes,
            explicitStartMinutes + durationMinutes,
            busyStart,
            busyEnd,
          ),
        );

        if (explicitEndsToday && explicitWithinAvailability && !overlaps) {
          resolvedTimestamp = item.normalizedTimeBlockStart;
          addBusyInterval(
            busyByDateKey,
            explicitDateKey,
            explicitStartMinutes,
            item.estimatedHours,
          );
        }
      }
    }

    if (resolvedTimestamp === null) {
      const preferredStartMinutes = suggestTimeBlockStart(
        desiredDateKey,
        item.estimatedHours,
        busyByDateKey,
      );
      const startMinutes = preferredStartMinutes;

      if (startMinutes !== null) {
        const timestamp = zonedDateTimeToUtcTimestamp(desiredDateKey, startMinutes);
        if (timestamp !== null) {
          resolvedTimestamp = timestamp;
          addBusyInterval(
            busyByDateKey,
            desiredDateKey,
            startMinutes,
            item.estimatedHours,
          );
        }
      }
    }

    results.set(item.candidate.key, resolvedTimestamp);
  }

  return results;
}

export function planGeneratedTodos(
  generatedTodos: GeneratedTodo[],
  existingTodos: ExistingTodoForPlanning[],
  now = Date.now(),
  options: ReconciliationOptions = {},
): PlannedTodo[] {
  return planTodoReconciliation(generatedTodos, existingTodos, now, options).create;
}
