import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  getRouteAuth,
  unauthorizedJson,
  validateApiKeyPermission,
  validateCsrfForSessionAuth,
} from "@/lib/auth-server";
import { getEgeContext } from "@/lib/ege-context";
import { generateTodosFromThought } from "@/lib/ai";
import { api, convex } from "@/lib/convex-server";
import { planTodoReconciliation } from "@/lib/todo-planning";

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const USER_TIMEZONE = "America/Chicago";
const USER_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: USER_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getExternalId(params: { externalId: string }) {
  const externalId = params.externalId?.trim();
  if (!externalId || externalId.length > 64) {
    return null;
  }

  return externalId;
}

function getStartOfUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getUserDateKey(timestamp: number) {
  const parts = USER_DAY_FORMATTER.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return toDateKey(getStartOfUtcDay(timestamp));
  }

  return `${year}-${month}-${day}`;
}

function getStartOfUserDay(timestamp: number) {
  return Date.parse(`${getUserDateKey(timestamp)}T00:00:00.000Z`);
}

function toDateKey(utcStart: number) {
  return new Date(utcStart).toISOString().slice(0, 10);
}

function parseTodayStartUtc(today: unknown) {
  if (typeof today === "string") {
    const normalized = today.trim();
    if (DATE_KEY_REGEX.test(normalized)) {
      const parsed = Date.parse(`${normalized}T00:00:00.000Z`);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ externalId: string }> },
) {
  const auth = await getRouteAuth(request);
  if (!auth) {
    return unauthorizedJson();
  }
  const csrfError = validateCsrfForSessionAuth(request, auth);
  if (csrfError) {
    return csrfError;
  }
  const permissionError = validateApiKeyPermission(request, auth);
  if (permissionError) {
    return permissionError;
  }

  const resolvedParams = await params;
  const externalId = getExternalId(resolvedParams);

  if (!externalId) {
    return NextResponse.json({ error: "Invalid thought id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { today?: unknown } | null;
  const todayStartUtc = parseTodayStartUtc(body?.today);
  const effectiveTodayStartUtc = todayStartUtc ?? getStartOfUserDay(Date.now());
  const todayDateKey = toDateKey(effectiveTodayStartUtc);

  const thought = await convex.query(api.thoughts.getByExternalId, { externalId });
  if (!thought) {
    return NextResponse.json({ error: "Thought not found." }, { status: 404 });
  }

  const aiRunId = randomUUID();

  await convex.mutation(api.thoughts.updateStatus, {
    externalId,
    status: "processing",
    aiRunId,
  });

  try {
    const [profileContext, recentRunMemories] = await Promise.all([
      getEgeContext(),
      convex.query(api.memories.listRecentRunMemories, { limit: 8 }),
    ]);

    await convex.mutation(api.memories.upsertProfileMemory, {
      key: "ege:profile:agents-json",
      content: profileContext,
    });

    const generatedTodos = await generateTodosFromThought(thought.rawText, {
      profileContext,
      recentRunMemories: recentRunMemories.map((memory) => memory.content),
      todayDateKey,
    });

    if (todayStartUtc !== null) {
      await convex.mutation(api.todos.enforceDueDatesAndReschedule, {
        todayStartUtc,
      });
    }
    const existingTodos = await convex.query(api.todos.listAll, {});
    const reconciliationPlan = planTodoReconciliation(
      generatedTodos,
      existingTodos.map((todo) => ({
        id: String(todo._id),
        title: todo.title,
        notes: todo.notes ?? null,
        status: todo.status,
        dueDate: todo.dueDate ?? null,
        priority: todo.priority ?? 2,
        recurrence: todo.recurrence ?? "none",
        createdAt: todo.createdAt,
      })),
      effectiveTodayStartUtc,
    );

    if (reconciliationPlan.deleteIds.length > 0) {
      await Promise.all(
        reconciliationPlan.deleteIds.map((todoId) =>
          convex.mutation(api.todos.deleteOneByStringId, { todoId }),
        ),
      );
    }

    if (reconciliationPlan.update.length > 0) {
      await Promise.all(
        reconciliationPlan.update.map((todo) =>
          convex.mutation(api.todos.updateFromAgent, {
            todoId: todo.id as never,
            title: todo.title,
            notes: todo.notes,
            dueDate: todo.dueDateTimestamp,
            recurrence: todo.recurrence,
            priority: todo.priority,
          }),
        ),
      );
    }

    if (reconciliationPlan.create.length > 0) {
      await convex.mutation(api.todos.createMany, {
        thoughtId: thought._id,
        thoughtExternalId: externalId,
        items: reconciliationPlan.create.map((todo) => ({
          title: todo.title,
          notes: todo.notes,
          dueDate: todo.dueDateTimestamp,
          recurrence: todo.recurrence,
          priority: todo.priority,
          source: "ai" as const,
        })),
      });
    }

    await convex.mutation(api.thoughts.updateStatus, {
      externalId,
      status: "done",
      aiRunId,
      synced: true,
    });

    await convex.mutation(api.memories.addRunMemory, {
      runExternalId: externalId,
      content: `input="${thought.rawText.slice(0, 240)}" created=${reconciliationPlan.create.length} updated=${reconciliationPlan.update.length} deleted=${reconciliationPlan.deleteIds.length} todos titles=[${reconciliationPlan.create
        .map((todo) => todo.title)
        .slice(0, 6)
        .join(" | ")}]`,
    });

    return NextResponse.json({ ok: true, created: reconciliationPlan.create.length });
  } catch (error) {
    await convex.mutation(api.thoughts.updateStatus, {
      externalId,
      status: "failed",
      aiRunId,
      synced: true,
    });

    const message = error instanceof Error ? error.message : "AI generation failed.";

    await convex.mutation(api.memories.addRunMemory, {
      runExternalId: externalId,
      content: `input="${thought.rawText.slice(0, 240)}" failed="${message.slice(0, 220)}"`,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
