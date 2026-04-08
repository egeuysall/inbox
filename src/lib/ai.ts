import "server-only";

import type { GenerationPreferences } from "@/lib/types";

type AiTodo = {
  title: string;
  notes: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  timeBlockStart: number | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  priority: 1 | 2 | 3;
};

export type GeneratedTodo = AiTodo;

export type ExistingTodoForAgent = {
  id: string;
  title: string;
  notes: string | null;
  status: "open" | "done";
  dueDate: number | null;
  estimatedHours: number | null;
  timeBlockStart: number | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  priority: 1 | 2 | 3;
  createdAt: number;
};

export type TodoAgentUpdateOperation = {
  id: string;
  title?: string;
  notes?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
  timeBlockStart?: number | null;
  recurrence?: "none" | "daily" | "weekly" | "monthly";
  priority?: 1 | 2 | 3;
  status?: "open" | "done";
};

export type TodoAgentPlan = {
  mode: "mutate" | "create";
  create: AiTodo[];
  update: TodoAgentUpdateOperation[];
  deleteIds: string[];
  message: string | null;
};

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const VALID_RECURRENCE = new Set(["none", "daily", "weekly", "monthly"]);
const MAX_NOTES_LENGTH = 160;
const MAX_GENERATED_TODOS = 30;
const MAX_AGENT_UPDATES = 500;
const MAX_AGENT_DELETES = 500;
const CHECKLIST_ITEM_REGEX = /^\s*(?:[-*]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?/;

function estimateIntentCount(rawText: string) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const checklistItems = lines.filter((line) =>
    CHECKLIST_ITEM_REGEX.test(line),
  );
  if (checklistItems.length > 0) {
    return Math.min(MAX_GENERATED_TODOS, checklistItems.length);
  }

  const sentenceCandidates = rawText
    .split(/\n+|[.;]+|\b(?:and|then|also)\b/gi)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceCandidates.length === 0) {
    return 1;
  }

  return Math.min(12, sentenceCandidates.length);
}

function clampText(text: string, maxLength: number) {
  return text.trim().slice(0, maxLength);
}

function normalizeDueDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const candidate = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return null;
  }

  const parsed = Date.parse(`${candidate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return candidate;
}

function normalizeNotesDescription(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/\bcontext:\s*/gi, "")
    .replace(/\bnext:\s*/gi, "")
    .replace(/\s*;\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  return clampText(normalized, MAX_NOTES_LENGTH);
}

function fallbackNotesFromTitle(title: string) {
  const trimmed = title.trim().replace(/[.!?]+$/g, "");
  if (!trimmed) {
    return "Complete this task.";
  }

  return clampText(`Complete ${trimmed}.`, MAX_NOTES_LENGTH);
}

function normalizeEstimatedHours(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value < 0.25 || value > 24) {
    return null;
  }

  return Math.round(value * 4) / 4;
}

function getUserTimezoneOffsetAt(timestamp: number, timeZone: string) {
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
  hour: number,
  minute: number,
  timeZone: string,
) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = getUserTimezoneOffsetAt(guess, timeZone);
  let resolved = Date.UTC(year, month - 1, day, hour, minute, 0) - offset;
  const adjustedOffset = getUserTimezoneOffsetAt(resolved, timeZone);
  if (adjustedOffset !== offset) {
    resolved = Date.UTC(year, month - 1, day, hour, minute, 0) - adjustedOffset;
  }

  return Number.isFinite(resolved) ? resolved : null;
}

function normalizeTimeBlockStart(value: unknown, dueDate: string | null, timeZone: string) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
    const [dateKey, timeText] = normalized.split("T");
    const [hourText, minuteText] = timeText.split(":");
    return zonedDateTimeToUtcTimestamp(
      dateKey,
      Number(hourText),
      Number(minuteText),
      timeZone,
    );
  }

  if (/^\d{2}:\d{2}$/.test(normalized) && dueDate) {
    const [hourText, minuteText] = normalized.split(":");
    return zonedDateTimeToUtcTimestamp(
      dueDate,
      Number(hourText),
      Number(minuteText),
      timeZone,
    );
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizeTodos(
  value: unknown,
  maxTodos: number,
  requireTaskDescriptions: boolean,
): AiTodo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: AiTodo[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const titleSource = Reflect.get(candidate, "title");
    const notesSource = Reflect.get(candidate, "notes");
    const dueDateSource = Reflect.get(candidate, "dueDate");
    const estimatedHoursSource = Reflect.get(candidate, "estimatedHours");
    const timeBlockStartSource = Reflect.get(candidate, "timeBlockStart");
    const recurrenceSource = Reflect.get(candidate, "recurrence");
    const prioritySource = Reflect.get(candidate, "priority");

    if (typeof titleSource !== "string") {
      continue;
    }

    const title = clampText(titleSource, 140);
    if (!title) {
      continue;
    }

    const notes = requireTaskDescriptions
      ? normalizeNotesDescription(notesSource) ?? fallbackNotesFromTitle(title)
      : normalizeNotesDescription(notesSource);
    const dueDate = normalizeDueDate(dueDateSource);
    const estimatedHours = normalizeEstimatedHours(estimatedHoursSource);
    const timeBlockStart = normalizeTimeBlockStart(
      timeBlockStartSource,
      dueDate,
      "America/Chicago",
    );
    const recurrence =
      typeof recurrenceSource === "string" &&
      VALID_RECURRENCE.has(recurrenceSource)
        ? (recurrenceSource as AiTodo["recurrence"])
        : "none";
    const priority =
      prioritySource === 1 || prioritySource === 2 || prioritySource === 3
        ? (prioritySource as AiTodo["priority"])
        : 2;

    items.push({
      title,
      notes,
      dueDate,
      estimatedHours,
      timeBlockStart,
      recurrence,
      priority,
    });

    if (items.length >= maxTodos) {
      break;
    }
  }

  return items;
}

function normalizeTodoUpdateOperations(
  value: unknown,
  existingTodoIds: Set<string>,
  requireTaskDescriptions: boolean,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  const updates: TodoAgentUpdateOperation[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const idSource = Reflect.get(candidate, "id");
    if (typeof idSource !== "string") {
      continue;
    }

    const id = idSource.trim();
    if (!id || !existingTodoIds.has(id)) {
      continue;
    }

    const nextUpdate: TodoAgentUpdateOperation = { id };

    if (Reflect.has(candidate, "title")) {
      const titleSource = Reflect.get(candidate, "title");
      if (typeof titleSource === "string") {
        const title = clampText(titleSource, 140);
        if (title) {
          nextUpdate.title = title;
        }
      }
    }

    if (Reflect.has(candidate, "notes")) {
      const notesSource = Reflect.get(candidate, "notes");
      if (notesSource === null) {
        nextUpdate.notes = null;
      } else {
        const normalizedNotes = normalizeNotesDescription(notesSource);
        if (normalizedNotes) {
          nextUpdate.notes = normalizedNotes;
        } else if (
          requireTaskDescriptions &&
          typeof nextUpdate.title === "string" &&
          nextUpdate.title.length > 0
        ) {
          nextUpdate.notes = fallbackNotesFromTitle(nextUpdate.title);
        }
      }
    }

    if (Reflect.has(candidate, "dueDate")) {
      const dueDateSource = Reflect.get(candidate, "dueDate");
      if (dueDateSource === null) {
        nextUpdate.dueDate = null;
      } else {
        const normalizedDueDate = normalizeDueDate(dueDateSource);
        if (normalizedDueDate) {
          nextUpdate.dueDate = normalizedDueDate;
        }
      }
    }

    if (Reflect.has(candidate, "estimatedHours")) {
      const estimatedHoursSource = Reflect.get(candidate, "estimatedHours");
      if (estimatedHoursSource === null) {
        nextUpdate.estimatedHours = null;
      } else {
        const normalizedEstimatedHours = normalizeEstimatedHours(
          estimatedHoursSource,
        );
        if (normalizedEstimatedHours !== null) {
          nextUpdate.estimatedHours = normalizedEstimatedHours;
        }
      }
    }

    if (Reflect.has(candidate, "timeBlockStart")) {
      const timeBlockStartSource = Reflect.get(candidate, "timeBlockStart");
      if (timeBlockStartSource === null) {
        nextUpdate.timeBlockStart = null;
      } else {
        const dueDateForNormalization =
          typeof nextUpdate.dueDate === "string" ? nextUpdate.dueDate : null;
        const normalizedTimeBlockStart = normalizeTimeBlockStart(
          timeBlockStartSource,
          dueDateForNormalization,
          "America/Chicago",
        );
        if (normalizedTimeBlockStart !== null) {
          nextUpdate.timeBlockStart = normalizedTimeBlockStart;
        }
      }
    }

    if (Reflect.has(candidate, "recurrence")) {
      const recurrenceSource = Reflect.get(candidate, "recurrence");
      if (
        typeof recurrenceSource === "string" &&
        VALID_RECURRENCE.has(recurrenceSource)
      ) {
        nextUpdate.recurrence = recurrenceSource as TodoAgentUpdateOperation["recurrence"];
      }
    }

    if (Reflect.has(candidate, "priority")) {
      const prioritySource = Reflect.get(candidate, "priority");
      if (prioritySource === 1 || prioritySource === 2 || prioritySource === 3) {
        nextUpdate.priority = prioritySource;
      }
    }

    if (Reflect.has(candidate, "status")) {
      const statusSource = Reflect.get(candidate, "status");
      if (statusSource === "open" || statusSource === "done") {
        nextUpdate.status = statusSource;
      }
    }

    if (Object.keys(nextUpdate).length > 1) {
      updates.push(nextUpdate);
    }

    if (updates.length >= MAX_AGENT_UPDATES) {
      break;
    }
  }

  return updates;
}

function normalizeDeleteIds(value: unknown, existingTodoIds: Set<string>) {
  if (!Array.isArray(value)) {
    return [];
  }

  const deleteIds: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== "string") {
      continue;
    }

    const id = candidate.trim();
    if (!id || seen.has(id) || !existingTodoIds.has(id)) {
      continue;
    }

    seen.add(id);
    deleteIds.push(id);

    if (deleteIds.length >= MAX_AGENT_DELETES) {
      break;
    }
  }

  return deleteIds;
}

function tryParseContent(content: string) {
  const direct = (() => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  })();

  if (direct) {
    return direct;
  }

  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      return null;
    }
  }

  return null;
}

type GenerationOptions = {
  profileContext: string;
  recentRunMemories: string[];
  todayDateKey: string;
  preferences?: GenerationPreferences;
};

type AgentGenerationOptions = GenerationOptions & {
  existingTodos: ExistingTodoForAgent[];
};

function formatExistingTodosForAgent(existingTodos: ExistingTodoForAgent[]) {
  if (existingTodos.length === 0) {
    return "No existing todos.";
  }

  return existingTodos
    .map((todo) => {
      const dueDate =
        typeof todo.dueDate === "number"
          ? new Date(todo.dueDate).toISOString().slice(0, 10)
          : "none";
      const start =
        typeof todo.timeBlockStart === "number"
          ? new Date(todo.timeBlockStart).toISOString().slice(11, 16)
          : "none";
      const estimatedHours =
        typeof todo.estimatedHours === "number"
          ? String(todo.estimatedHours)
          : "unsized";
      const notes = (todo.notes ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 110);

      return [
        `id=${todo.id}`,
        `status=${todo.status}`,
        `priority=p${todo.priority}`,
        `due=${dueDate}`,
        `start=${start}`,
        `hours=${estimatedHours}`,
        `recurrence=${todo.recurrence}`,
        `title="${todo.title.slice(0, 120)}"`,
        notes ? `notes="${notes}"` : "",
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");
}

export async function generateTodoAgentPlanFromThought(
  rawText: string,
  options: AgentGenerationOptions,
): Promise<TodoAgentPlan> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const model = process.env.AI_AGENT_MODEL || "openai/gpt-5.4-nano";

  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is required.");
  }

  const preferences = options.preferences;
  const autoSchedule = preferences?.autoSchedule ?? true;
  const includeRelevantLinks = preferences?.includeRelevantLinks ?? true;
  const requireTaskDescriptions = preferences?.requireTaskDescriptions ?? true;
  const availabilityNotes =
    typeof preferences?.availabilityNotes === "string" &&
    preferences.availabilityNotes.trim().length > 0
      ? preferences.availabilityNotes.trim().slice(0, 640)
      : null;

  const memoryBlock = options.recentRunMemories.length
    ? options.recentRunMemories
        .map((memory, index) => `${index + 1}. ${memory}`)
        .join("\n")
    : "No past run memory available yet.";
  const estimatedIntentCount = estimateIntentCount(rawText);
  const maxTodosForPrompt = Math.max(
    1,
    Math.min(MAX_GENERATED_TODOS, estimatedIntentCount * 2),
  );
  const existingTodosBlock = formatExistingTodosForAgent(options.existingTodos);
  const existingTodoIds = new Set(options.existingTodos.map((todo) => todo.id));

  const response = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are ibx's todo operations agent. 
Decide whether the user input should mutate existing todos, create new todos, or both.
Return strict JSON only in this shape:
{
  "mode":"mutate"|"create",
  "create":[{"title":"...", "notes": string|null, "dueDate":"YYYY-MM-DD"|null, "estimatedHours": number|null, "timeBlockStart":"YYYY-MM-DDTHH:mm"|null, "recurrence":"none"|"daily"|"weekly"|"monthly", "priority":1|2|3}],
  "update":[{"id":"existing-id", "title"?:string, "notes"?:string|null, "dueDate"?: "YYYY-MM-DD"|null, "estimatedHours"?: number|null, "timeBlockStart"?: "YYYY-MM-DDTHH:mm"|null, "recurrence"?: "none"|"daily"|"weekly"|"monthly", "priority"?:1|2|3, "status"?: "open"|"done"}],
  "deleteIds":["existing-id"],
  "message":string|null
}

Rules:
- If the prompt asks to schedule/prioritize/reschedule/move/update/delete existing tasks, use mode="mutate" and operate on existing todo IDs.
- Do NOT create a task for a command. Execute commands as updates/deletes.
- If the prompt asks for both command-style mutations and new tasks, include both update/delete and create.
- Never invent IDs. Use only IDs from Existing Todos.
- For bulk requests (example: "put all upcoming tasks to today"), include one update entry per matching todo id.
- Default dueDate for created todos to ${options.todayDateKey} unless explicitly specified.
- Keep titles actionable and <= 140 chars.
- Keep notes concise and <= ${MAX_NOTES_LENGTH} chars.
- ${
    requireTaskDescriptions
      ? "Each created todo must have non-empty notes."
      : "Created notes may be null when no useful context exists."
  }
- ${
    includeRelevantLinks
      ? "If user mentions resources or URLs, include full URLs in notes when directly relevant."
      : "Do not include URLs unless explicitly requested."
  }
- ${
    autoSchedule
      ? "Set timeBlockStart for created todos when timing is explicit or strongly implied."
      : "Set timeBlockStart to null unless explicit."
  }
- Timezone is America/Chicago.
- Scheduling constraints:
  - Monday and Tuesday: unavailable before 18:00.
  - Wednesday, Thursday, Friday: unavailable before 17:00.
  - Sunday: avoid 11:00-12:00 and 19:00-20:00.
- ${
    availabilityNotes
      ? `Additional availability preferences: ${availabilityNotes}.`
      : "No additional availability preferences provided."
  }
- Keep at most ${maxTodosForPrompt} items in create.
- If no changes are needed, return empty arrays.

About Ege:
${options.profileContext}

Recent run memory:
${memoryBlock}

Existing Todos:
${existingTodosBlock}`,
        },
        {
          role: "user",
          content: rawText,
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`AI request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return {
      mode: "create",
      create: [],
      update: [],
      deleteIds: [],
      message: null,
    };
  }

  const parsed = tryParseContent(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response was not valid JSON.");
  }

  const modeSource = Reflect.get(parsed, "mode");
  const mode = modeSource === "mutate" ? "mutate" : "create";
  const create = normalizeTodos(
    Reflect.get(parsed, "create"),
    maxTodosForPrompt,
    requireTaskDescriptions,
  );
  const update = normalizeTodoUpdateOperations(
    Reflect.get(parsed, "update"),
    existingTodoIds,
    requireTaskDescriptions,
  );
  const deleteIds = normalizeDeleteIds(
    Reflect.get(parsed, "deleteIds"),
    existingTodoIds,
  );
  const messageSource = Reflect.get(parsed, "message");
  const message =
    typeof messageSource === "string" ? clampText(messageSource, 240) : null;

  return {
    mode,
    create,
    update,
    deleteIds,
    message,
  };
}

export async function generateTodosFromThought(
  rawText: string,
  options: GenerationOptions,
) {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const model = process.env.AI_AGENT_MODEL || "openai/gpt-5.4-nano";

  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is required.");
  }

  const preferences = options.preferences;
  const autoSchedule = preferences?.autoSchedule ?? true;
  const includeRelevantLinks = preferences?.includeRelevantLinks ?? true;
  const requireTaskDescriptions = preferences?.requireTaskDescriptions ?? true;
  const availabilityNotes =
    typeof preferences?.availabilityNotes === "string" &&
    preferences.availabilityNotes.trim().length > 0
      ? preferences.availabilityNotes.trim().slice(0, 640)
      : null;

  const memoryBlock = options.recentRunMemories.length
    ? options.recentRunMemories
        .map((memory, index) => `${index + 1}. ${memory}`)
        .join("\n")
    : "No past run memory available yet.";
  const estimatedIntentCount = estimateIntentCount(rawText);
  const maxTodosForPrompt = Math.max(
    1,
    Math.min(MAX_GENERATED_TODOS, estimatedIntentCount * 2),
  );

  const response = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You convert a messy thought into actionable todos for Ege.
Return strict JSON only: an array of objects.
Each object must be:
{"title":"...", "notes": string, "dueDate":"YYYY-MM-DD"|null, "estimatedHours": number|null, "timeBlockStart":"YYYY-MM-DDTHH:mm"|null, "recurrence":"none"|"daily"|"weekly"|"monthly", "priority":1|2|3}

Rules:
	- Keep titles short and actionable.
	- Keep notes concise (max ${MAX_NOTES_LENGTH} chars) as plain readable description text.
	- ${
    requireTaskDescriptions
      ? "Notes are required for every todo and must never be empty."
      : "Notes are optional. If there is no useful context, set notes to null."
  }
	- Never use labels like "context:" or "next:" in notes.
	- Never output long writing instructions or multi-step paragraphs in notes.
	- ${
    includeRelevantLinks
      ? "If the input contains meeting/resource URLs (including bare domains like youtube.com), include full https/http URLs directly in notes."
      : "Do not include URLs in notes unless the user explicitly asks for links."
  }
	- ${
    includeRelevantLinks
      ? "Only include links when directly relevant to that task."
      : "When links are disabled, keep notes text-only."
  }
- Create one todo per concrete intent. Do not split one intent into meta subtasks.
- Do not add planning/setup tasks like "plan how to..." unless explicitly requested.
- Use recurrence only when the thought clearly implies repeated cadence.
- Today's date in the user's timezone is ${options.todayDateKey}.
- Default dueDate to ${options.todayDateKey}.
- Only use a different dueDate when the prompt explicitly states another time/date (e.g. tomorrow, this weekend, next week, on Friday, specific date).
- If the prompt uses relative timing, convert it to a concrete YYYY-MM-DD date.
	- Always estimate effort with estimatedHours (0.25 to 24, quarter-hour increments).
	- ${
    autoSchedule
      ? "Set timeBlockStart when timing is known or can be reasonably inferred from urgency/effort; otherwise null."
      : "Keep timeBlockStart null unless the user provides an explicit time."
  }
- Timezone for scheduling is America/Chicago.
- Weekly availability constraints:
  - Monday and Tuesday: unavailable before 18:00 (school until 6pm).
  - Wednesday, Thursday, Friday: unavailable before 17:00 (school until 5pm).
  - Saturday: generally free.
  - Sunday: avoid 11:00-12:00 and 19:00-20:00 (meetings).
	- Do not schedule outside these constraints unless the user explicitly asks.
	- ${
    availabilityNotes
      ? `Additional user availability preferences: ${availabilityNotes}.`
      : "No additional user availability preferences provided."
  }
- Set priority: 1=must-do today, 2=important, 3=nice-to-have.
- Keep at most ${maxTodosForPrompt} todos for this input.
- If no actionable todos exist, return [].

About Ege:
${options.profileContext}

Recent run memory:
${memoryBlock}`,
        },
        {
          role: "user",
          content: rawText,
        },
      ],
    }),
    signal: AbortSignal.timeout(18_000),
  });

  if (!response.ok) {
    throw new Error(`AI request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return [];
  }

  const parsed = tryParseContent(content);
  if (!parsed) {
    throw new Error("AI response was not valid JSON.");
  }

  if (Array.isArray(parsed)) {
    return normalizeTodos(parsed, maxTodosForPrompt, requireTaskDescriptions);
  }

  if (typeof parsed === "object" && parsed) {
    const nested = Reflect.get(parsed, "todos");
    return normalizeTodos(nested, maxTodosForPrompt, requireTaskDescriptions);
  }

  return [];
}
