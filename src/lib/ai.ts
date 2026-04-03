import "server-only";

type AiTodo = {
  title: string;
  notes: string | null;
  dueDate: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
};

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const VALID_RECURRENCE = new Set(["none", "daily", "weekly", "monthly"]);

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

function normalizeTodos(value: unknown): AiTodo[] {
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

    if (typeof titleSource !== "string") {
      continue;
    }

    const title = clampText(titleSource, 140);
    if (!title) {
      continue;
    }

    const notes = typeof notesSource === "string" ? clampText(notesSource, 1200) : null;
    const dueDate = normalizeDueDate(dueDateSource);
    const recurrence =
      typeof recurrenceSource === "string" && VALID_RECURRENCE.has(recurrenceSource)
        ? (recurrenceSource as AiTodo["recurrence"])
        : "none";

    items.push({ title, notes: notes || null, dueDate, recurrence });

    if (items.length >= 20) {
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
{"title":"...", "notes": string|null, "dueDate":"YYYY-MM-DD"|null, "recurrence":"none"|"daily"|"weekly"|"monthly"}

Rules:
- Keep titles short and actionable.
- Use recurrence only when the thought clearly implies repeated cadence.
- Use dueDate only when a concrete date can be inferred.
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
    return normalizeTodos(parsed);
  }

  if (typeof parsed === "object" && parsed) {
    const nested = Reflect.get(parsed, "todos");
    return normalizeTodos(nested);
  }

  return [];
}
