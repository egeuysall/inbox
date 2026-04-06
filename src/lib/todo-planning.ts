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

export type ExistingTodoForPlanning = {
  id: string;
  title: string;
  notes: string | null;
  status: "open" | "done";
  dueDate?: number | null;
  priority?: 1 | 2 | 3 | null;
  recurrence?: "none" | "daily" | "weekly" | "monthly" | null;
  createdAt: number;
};

export type PlannedTodo = GeneratedTodo & {
  dueDateTimestamp: number;
  notes: string | null;
};

export type PlannedTodoUpdate = {
  id: string;
  title: string;
  notes: string | null;
  dueDateTimestamp: number;
  priority: 1 | 2 | 3;
  recurrence: "none" | "daily" | "weekly" | "monthly";
};

export type TodoReconciliationPlan = {
  create: PlannedTodo[];
  update: PlannedTodoUpdate[];
  deleteIds: string[];
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

function normalizePlannedTodo(todo: GeneratedTodo, todayStartUtc: number): PlannedTodo {
  const parsedDueDate = parseDueDateToTimestamp(todo.dueDate);
  const dueDateTimestamp =
    parsedDueDate !== null && parsedDueDate > todayStartUtc
      ? parsedDueDate
      : todayStartUtc;

  return {
    ...todo,
    title: normalizeTitleText(todo.title),
    notes: sanitizeNotes(todo.notes),
    priority: normalizePriority(todo.priority),
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

  return (
    existingTitle !== nextTodo.title ||
    existingNotes !== nextTodo.notes ||
    existingPriority !== nextTodo.priority ||
    existingRecurrence !== nextTodo.recurrence ||
    existingDueDate !== nextTodo.dueDateTimestamp
  );
}

export function planTodoReconciliation(
  generatedTodos: GeneratedTodo[],
  existingTodos: ExistingTodoForPlanning[],
  now = Date.now(),
): TodoReconciliationPlan {
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
    const cleaned: PlannedTodoUpdate = {
      id: todo.id,
      title: normalizeTitleText(todo.title),
      notes: sanitizeNotes(todo.notes),
      dueDateTimestamp:
        typeof todo.dueDate === "number" ? todo.dueDate : todayStartUtc,
      priority: normalizePriority(todo.priority),
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
    .map(({ todo }) => normalizePlannedTodo(todo, todayStartUtc));

  const seenGeneratedKeys = new Set<string>();
  for (const generatedTodo of generatedUnique) {
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

export function planGeneratedTodos(
  generatedTodos: GeneratedTodo[],
  existingTodos: ExistingTodoForPlanning[],
  now = Date.now(),
): PlannedTodo[] {
  return planTodoReconciliation(generatedTodos, existingTodos, now).create;
}
