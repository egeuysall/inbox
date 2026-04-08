import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  generateTodoAgentPlanFromThought,
  generateTodosFromThought,
} from "@/lib/ai";
import {
  getRouteAuth,
  unauthorizedJson,
  validateApiKeyPermission,
  validateCsrfForSessionAuth,
} from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";
import { getEgeContext } from "@/lib/ege-context";
import {
  resolveNonOverlappingTimeBlocks,
  type ExistingTodoForPlanning,
  type TimeBlockScheduleCandidate,
} from "@/lib/todo-planning";
import type { GenerationPreferences } from "@/lib/types";

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const API_KEY_LIKE_REGEX = /^iak_[A-Za-z0-9_-]{16,}$/;
const SHORTCUT_QUEUE_MARKER_REGEX = /^\s*IBX_QUEUE\b/im;
const SHORTCUT_CAPTURE_ID_REGEX = /^captureId:\s*([^\n\r]+)\s*$/im;
const SHORTCUT_TEXT_REGEX = /^text:\s*([\s\S]+)$/im;
const DELETE_INTENT_REGEX =
  /\b(delete|remove|clear|drop|erase|trash|wipe)\b/i;
const SCHEDULE_INTENT_REGEX =
  /\b(schedule|reschedule|time-?block|calendar|slot|move)\b/i;
const GLOBAL_TASK_TARGET_REGEX =
  /\b(all(?:\s+my)?\s+tasks?|all\s+todos?|everything)\b/i;
const TODAY_TARGET_REGEX = /\btoday\b/i;
const MAX_AGENT_DELETE_OPS = 250;
const MAX_AGENT_UPDATE_OPS = 250;
const MAX_AGENT_CREATE_OPS = 100;
const USER_TIMEZONE = "America/Chicago";
const USER_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: USER_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function normalizeInputText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().slice(0, 8_000);
  return normalized.length ? normalized : null;
}

function looksLikeApiKeyPayload(text: string) {
  return API_KEY_LIKE_REGEX.test(text.trim());
}

function toShortcutExternalId(captureId: string) {
  const normalized = captureId.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  if (!normalized) {
    return null;
  }

  return `shortcut-${normalized}`;
}

function parseShortcutQueuePayload(input: string) {
  if (!SHORTCUT_QUEUE_MARKER_REGEX.test(input)) {
    return null;
  }

  const captureId = SHORTCUT_CAPTURE_ID_REGEX.exec(input)?.[1]?.trim() ?? null;
  const extractedText = SHORTCUT_TEXT_REGEX.exec(input)?.[1] ?? input;
  const normalizedText = normalizeInputText(extractedText);

  if (!normalizedText) {
    return null;
  }

  return {
    captureId,
    text: normalizedText,
  };
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

function parseGenerationPreferences(value: unknown): GenerationPreferences {
  const source =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  const autoSchedule = source.autoSchedule !== false;
  const includeRelevantLinks = source.includeRelevantLinks !== false;
  const requireTaskDescriptions = source.requireTaskDescriptions !== false;
  const availabilityNotes =
    typeof source.availabilityNotes === "string"
      ? source.availabilityNotes.trim().slice(0, 640) || null
      : null;

  return {
    autoSchedule,
    includeRelevantLinks,
    requireTaskDescriptions,
    availabilityNotes,
  };
}

function hasExplicitDeleteIntent(inputText: string) {
  return DELETE_INTENT_REGEX.test(inputText);
}

function hasSchedulingIntent(inputText: string) {
  return SCHEDULE_INTENT_REGEX.test(inputText);
}

function hasGlobalRescheduleIntent(inputText: string) {
  return hasSchedulingIntent(inputText) && GLOBAL_TASK_TARGET_REGEX.test(inputText);
}

function hasForceTodayTarget(inputText: string) {
  return TODAY_TARGET_REGEX.test(inputText);
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
    return 2;
  }

  if (priority === 2) {
    return 1;
  }

  return 0.5;
}

function normalizePriority(priority: 1 | 2 | 3 | null | undefined): 1 | 2 | 3 {
  if (priority === 1 || priority === 3) {
    return priority;
  }

  return 2;
}

function toExistingTodoSnapshot(
  todos: Array<{
    _id: unknown;
    title: string;
    notes: string | null;
    status: "open" | "done";
    dueDate?: number | null;
    estimatedHours?: number | null;
    timeBlockStart?: number | null;
    priority?: 1 | 2 | 3 | null;
    recurrence?: "none" | "daily" | "weekly" | "monthly" | null;
    createdAt: number;
  }>,
) {
  return todos.map((todo) => ({
    id: String(todo._id),
    title: todo.title,
    notes: todo.notes ?? null,
    status: todo.status,
    dueDate: todo.dueDate ?? null,
    estimatedHours:
      typeof todo.estimatedHours === "number" ? todo.estimatedHours : null,
    timeBlockStart:
      typeof todo.timeBlockStart === "number" ? todo.timeBlockStart : null,
    priority: todo.priority ?? 2,
    recurrence: todo.recurrence ?? "none",
    createdAt: todo.createdAt,
  }));
}

export async function POST(request: NextRequest) {
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

  const body = (await request.json().catch(() => null)) as
    | { text?: unknown; today?: unknown; preferences?: unknown }
    | null;
  const submittedText = normalizeInputText(body?.text);
  const todayStartUtc = parseTodayStartUtc(body?.today);
  const preferences = parseGenerationPreferences(body?.preferences);
  const effectiveTodayStartUtc = todayStartUtc ?? getStartOfUserDay(Date.now());
  const todayDateKey = toDateKey(effectiveTodayStartUtc);

  if (!submittedText) {
    return NextResponse.json({ error: "Input is required." }, { status: 400 });
  }

  const parsedShortcutQueue = parseShortcutQueuePayload(submittedText);
  const inputText = parsedShortcutQueue?.text ?? submittedText;
  const shortcutExternalId = parsedShortcutQueue?.captureId
    ? toShortcutExternalId(parsedShortcutQueue.captureId)
    : null;

  if (looksLikeApiKeyPayload(inputText)) {
    return NextResponse.json(
      {
        error:
          "Received an API key in text payload. Your shortcut is using the wrong variable. Reinstall the latest ibx-capture shortcut.",
      },
      { status: 400 },
    );
  }

  const externalId = shortcutExternalId ?? randomUUID();
  if (shortcutExternalId) {
    const existingThought = await convex.query(api.thoughts.getByExternalId, {
      externalId: shortcutExternalId,
    });

    if (existingThought && (existingThought.status === "done" || existingThought.status === "processing")) {
      return NextResponse.json({
        ok: true,
        runId: shortcutExternalId,
        created: 0,
        deduped: true,
      });
    }
  }

  const aiRunId = randomUUID();
  const createdAt = Date.now();

  await convex.mutation(api.thoughts.upsert, {
    externalId,
    rawText: inputText,
    createdAt,
    status: "processing",
    synced: true,
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

    const thought = await convex.query(api.thoughts.getByExternalId, { externalId });
    if (!thought) {
      return NextResponse.json({ error: "Thought was not created." }, { status: 500 });
    }

    if (todayStartUtc !== null) {
      await convex.mutation(api.todos.enforceDueDatesAndReschedule, {
        todayStartUtc,
      });
    }
    const existingTodos = await convex.query(api.todos.listAll, {});
    const existingSnapshot = toExistingTodoSnapshot(existingTodos);
    const existingTodoIds = new Set(existingSnapshot.map((todo) => todo.id));

    const agentPlan = await generateTodoAgentPlanFromThought(inputText, {
      profileContext,
      recentRunMemories: recentRunMemories.map((memory) => memory.content),
      todayDateKey,
      preferences,
      existingTodos: existingSnapshot,
    }).catch(async () => {
      const generatedTodos = await generateTodosFromThought(inputText, {
        profileContext,
        recentRunMemories: recentRunMemories.map((memory) => memory.content),
        todayDateKey,
        preferences,
      });

      return {
        mode: "create" as const,
        create: generatedTodos,
        update: [],
        deleteIds: [],
        message: null,
      };
    });

    let deleted = 0;
    let updated = 0;
    let created = 0;

    const allowDeleteOps = hasExplicitDeleteIntent(inputText);
    const hasScheduleIntent = hasSchedulingIntent(inputText);
    const hasGlobalReschedule = hasGlobalRescheduleIntent(inputText);
    const forceTodayScheduling = hasGlobalReschedule && hasForceTodayTarget(inputText);
    const requestedDeleteIds = allowDeleteOps ? agentPlan.deleteIds : [];
    const filteredDeleteIds = requestedDeleteIds.filter((id) =>
      existingTodoIds.has(id),
    );
    const cappedDeleteIds = filteredDeleteIds.slice(0, MAX_AGENT_DELETE_OPS);
    const deleteIdSet = new Set(cappedDeleteIds);
    const filteredUpdateOps = agentPlan.update.filter(
      (update) => existingTodoIds.has(update.id) && !deleteIdSet.has(update.id),
    );
    const cappedUpdateOps = filteredUpdateOps.slice(0, MAX_AGENT_UPDATE_OPS);
    const updateOpsById = new Map(cappedUpdateOps.map((update) => [update.id, update]));
    if (hasGlobalReschedule) {
      for (const todo of existingSnapshot) {
        if (todo.status !== "open" || deleteIdSet.has(todo.id)) {
          continue;
        }

        if (!updateOpsById.has(todo.id)) {
          updateOpsById.set(todo.id, { id: todo.id, timeBlockStart: null });
        }
      }
    }
    const effectiveUpdateOps = Array.from(updateOpsById.values()).slice(
      0,
      MAX_AGENT_UPDATE_OPS,
    );
    const createItems = hasGlobalReschedule
      ? []
      : agentPlan.create.slice(0, MAX_AGENT_CREATE_OPS);
    const droppedMutationOps =
      (requestedDeleteIds.length - cappedDeleteIds.length) +
      (agentPlan.update.length - cappedUpdateOps.length);

    const existingById = new Map(existingSnapshot.map((todo) => [todo.id, todo]));
    const schedulingCandidates: TimeBlockScheduleCandidate[] = [];

    for (const update of effectiveUpdateOps) {
      const existingTodo = existingById.get(update.id);
      if (!existingTodo) {
        continue;
      }

      const nextStatus = update.status ?? existingTodo.status;
      if (nextStatus !== "open") {
        continue;
      }

      const nextPriority = normalizePriority(update.priority ?? existingTodo.priority);
      const nextEstimatedHours =
        normalizeEstimatedHours(update.estimatedHours ?? existingTodo.estimatedHours) ??
        defaultEstimatedHoursForPriority(nextPriority);
      const parsedDueDate = forceTodayScheduling
        ? effectiveTodayStartUtc
        : update.dueDate === undefined
          ? existingTodo.dueDate
          : update.dueDate === null
            ? null
            : Date.parse(`${update.dueDate}T00:00:00.000Z`);
      const nextDueDate =
        typeof parsedDueDate === "number" && Number.isFinite(parsedDueDate)
          ? parsedDueDate
          : effectiveTodayStartUtc;

      const touchesSchedulingFields =
        update.timeBlockStart !== undefined ||
        update.dueDate !== undefined ||
        update.estimatedHours !== undefined ||
        update.priority !== undefined;
      const shouldAutoScheduleUpdate =
        (preferences.autoSchedule && touchesSchedulingFields) || hasScheduleIntent;
      if (!shouldAutoScheduleUpdate && update.timeBlockStart === undefined) {
        continue;
      }

      schedulingCandidates.push({
        key: `u:${update.id}`,
        existingTodoId: update.id,
        status: nextStatus,
        dueDateTimestamp: nextDueDate,
        estimatedHours: nextEstimatedHours,
        priority: nextPriority,
        timeBlockStart:
          update.timeBlockStart !== undefined
            ? update.timeBlockStart
            : shouldAutoScheduleUpdate
              ? null
              : existingTodo.timeBlockStart,
      });
    }

    for (let index = 0; index < createItems.length; index += 1) {
      const todo = createItems[index];
      const nextPriority = normalizePriority(todo.priority);
      const nextEstimatedHours =
        normalizeEstimatedHours(todo.estimatedHours) ??
        defaultEstimatedHoursForPriority(nextPriority);
      const parsedDueDate = todo.dueDate
        ? Date.parse(`${todo.dueDate}T00:00:00.000Z`)
        : NaN;
      const nextDueDate = Number.isFinite(parsedDueDate)
        ? parsedDueDate
        : effectiveTodayStartUtc;

      if (!preferences.autoSchedule && todo.timeBlockStart === null) {
        continue;
      }

      schedulingCandidates.push({
        key: `c:${index}`,
        status: "open",
        dueDateTimestamp: nextDueDate,
        estimatedHours: nextEstimatedHours,
        priority: nextPriority,
        timeBlockStart: todo.timeBlockStart,
      });
    }

    const schedulingBaseTodos: ExistingTodoForPlanning[] = existingSnapshot
      .filter((todo) => todo.status === "open" && !deleteIdSet.has(todo.id))
      .map((todo) => ({ ...todo }));

    const resolvedTimeBlocks = resolveNonOverlappingTimeBlocks(
      schedulingBaseTodos,
      schedulingCandidates,
      {
        todayStartUtc: effectiveTodayStartUtc,
      },
    );

    for (const deleteId of cappedDeleteIds) {
      if (!existingTodoIds.has(deleteId)) {
        continue;
      }

      const deletedTodoId = await convex.mutation(api.todos.deleteOneByStringId, {
        todoId: deleteId,
      });
      if (deletedTodoId) {
        deleted += 1;
        existingTodoIds.delete(deleteId);
      }
    }

    for (const update of effectiveUpdateOps) {
      if (!existingTodoIds.has(update.id)) {
        continue;
      }

      let touched = false;
      const patch: {
        todoId: string;
        title?: string;
        notes?: string | null;
        dueDate?: number | null;
        estimatedHours?: number | null;
        timeBlockStart?: number | null;
        recurrence?: "none" | "daily" | "weekly" | "monthly";
        priority?: 1 | 2 | 3;
      } = {
        todoId: update.id,
      };

      if (update.title !== undefined) {
        patch.title = update.title;
        touched = true;
      }

      if (update.notes !== undefined) {
        patch.notes = update.notes;
        touched = true;
      }

      if (forceTodayScheduling) {
        patch.dueDate = effectiveTodayStartUtc;
        touched = true;
      } else if (update.dueDate !== undefined) {
        if (update.dueDate === null) {
          patch.dueDate = null;
          touched = true;
        } else {
          const parsedDueDate = Date.parse(`${update.dueDate}T00:00:00.000Z`);
          if (Number.isFinite(parsedDueDate)) {
            patch.dueDate = parsedDueDate;
            touched = true;
          }
        }
      }

      if (update.estimatedHours !== undefined) {
        patch.estimatedHours = update.estimatedHours;
        touched = true;
      }

      const resolvedTimeBlockStart = resolvedTimeBlocks.get(`u:${update.id}`);
      if (resolvedTimeBlockStart !== undefined) {
        patch.timeBlockStart = resolvedTimeBlockStart;
        touched = true;
      } else if (update.timeBlockStart !== undefined) {
        patch.timeBlockStart = update.timeBlockStart;
        touched = true;
      }

      if (update.recurrence !== undefined) {
        patch.recurrence = update.recurrence;
        touched = true;
      }

      if (update.priority !== undefined) {
        patch.priority = update.priority;
        touched = true;
      }

      if (touched) {
        await convex.mutation(api.todos.updateFromAgent, {
          todoId: patch.todoId as never,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
          ...(patch.estimatedHours !== undefined
            ? { estimatedHours: patch.estimatedHours }
            : {}),
          ...(patch.timeBlockStart !== undefined
            ? { timeBlockStart: patch.timeBlockStart }
            : {}),
          ...(patch.recurrence !== undefined
            ? { recurrence: patch.recurrence }
            : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        });
      }

      if (update.status !== undefined) {
        await convex.mutation(api.todos.updateStatus, {
          todoId: update.id as never,
          status: update.status,
        });
        touched = true;
      }

      if (touched) {
        updated += 1;
      }
    }

    if (createItems.length > 0) {
      await convex.mutation(api.todos.createMany, {
        thoughtId: thought._id,
        thoughtExternalId: externalId,
        items: createItems.map((todo, index) => {
          const parsedDueDate = todo.dueDate
            ? Date.parse(`${todo.dueDate}T00:00:00.000Z`)
            : NaN;
          const createKey = `c:${index}`;
          const hasResolvedCreateTime = resolvedTimeBlocks.has(createKey);

          return {
            title: todo.title,
            notes: todo.notes,
            dueDate: Number.isFinite(parsedDueDate) ? parsedDueDate : null,
            estimatedHours: todo.estimatedHours,
            timeBlockStart:
              hasResolvedCreateTime
                ? (resolvedTimeBlocks.get(createKey) ?? null)
                : todo.timeBlockStart,
            recurrence: todo.recurrence,
            priority: todo.priority,
            source: "ai" as const,
          };
        }),
      });
      created = createItems.length;
    }

    await convex.mutation(api.thoughts.updateStatus, {
      externalId,
      status: "done",
      aiRunId,
      synced: true,
    });

    await convex.mutation(api.memories.addRunMemory, {
      runExternalId: externalId,
      content: `input="${inputText.slice(0, 240)}" mode=${agentPlan.mode} created=${created} updated=${updated} deleted=${deleted} todos titles=[${agentPlan.create
        .map((todo) => todo.title)
        .slice(0, 6)
        .join(" | ")}] droppedMutationOps=${droppedMutationOps}`,
    });

    const responseMessage = hasGlobalReschedule
      ? `Rescheduled open tasks with non-overlap and availability constraints (${USER_TIMEZONE}).`
      : agentPlan.message;

    return NextResponse.json({
      ok: true,
      runId: externalId,
      created,
      updated,
      deleted,
      mode: agentPlan.mode,
      message: responseMessage,
      droppedMutationOps,
    });
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
      content: `input="${inputText.slice(0, 240)}" failed="${message.slice(0, 220)}"`,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
