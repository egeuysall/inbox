import "server-only";

type AiTodo = {
  title: string;
  notes: string | null;
  dueDate: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  priority: 1 | 2 | 3;
};

export type GeneratedTodo = AiTodo;

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const VALID_RECURRENCE = new Set(["none", "daily", "weekly", "monthly"]);
const MAX_NOTES_LENGTH = 160;
const MAX_GENERATED_TODOS = 30;
const CHECKLIST_ITEM_REGEX = /^\s*(?:[-*]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?/;

function estimateIntentCount(rawText: string) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const checklistItems = lines.filter((line) => CHECKLIST_ITEM_REGEX.test(line));
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

function normalizeTodos(value: unknown, maxTodos: number): AiTodo[] {
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
    const recurrenceSource = Reflect.get(candidate, "recurrence");
    const prioritySource = Reflect.get(candidate, "priority");

    if (typeof titleSource !== "string") {
      continue;
    }

    const title = clampText(titleSource, 140);
    if (!title) {
      continue;
    }

    const notes = normalizeNotesDescription(notesSource);
    const dueDate = normalizeDueDate(dueDateSource);
    const recurrence =
      typeof recurrenceSource === "string" && VALID_RECURRENCE.has(recurrenceSource)
        ? (recurrenceSource as AiTodo["recurrence"])
        : "none";
    const priority =
      prioritySource === 1 || prioritySource === 2 || prioritySource === 3
        ? (prioritySource as AiTodo["priority"])
        : 2;

    items.push({ title, notes: notes || null, dueDate, recurrence, priority });

    if (items.length >= maxTodos) {
      break;
    }
  }

  return items;
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
};

export async function generateTodosFromThought(rawText: string, options: GenerationOptions) {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const model = process.env.AI_AGENT_MODEL || "openai/gpt-5.4-nano";

  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is required.");
  }

  const memoryBlock = options.recentRunMemories.length
    ? options.recentRunMemories.map((memory, index) => `${index + 1}. ${memory}`).join("\n")
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
{"title":"...", "notes": string|null, "dueDate":"YYYY-MM-DD"|null, "recurrence":"none"|"daily"|"weekly"|"monthly", "priority":1|2|3}

Rules:
- Keep titles short and actionable.
- Keep notes concise (max ${MAX_NOTES_LENGTH} chars) as plain readable description text.
- Never use labels like "context:" or "next:" in notes.
- Never output long writing instructions or multi-step paragraphs in notes.
- Create one todo per concrete intent. Do not split one intent into meta subtasks.
- Do not add planning/setup tasks like "plan how to..." unless explicitly requested.
- Use recurrence only when the thought clearly implies repeated cadence.
- Today's date in the user's timezone is ${options.todayDateKey}.
- Default dueDate to ${options.todayDateKey}.
- Only use a different dueDate when the prompt explicitly states another time/date (e.g. tomorrow, this weekend, next week, on Friday, specific date).
- If the prompt uses relative timing, convert it to a concrete YYYY-MM-DD date.
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
    return normalizeTodos(parsed, maxTodosForPrompt);
  }

  if (typeof parsed === "object" && parsed) {
    const nested = Reflect.get(parsed, "todos");
    return normalizeTodos(nested, maxTodosForPrompt);
  }

  return [];
}
