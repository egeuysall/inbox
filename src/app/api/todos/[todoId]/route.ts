import { NextRequest, NextResponse } from "next/server";

import {
  getRouteAuth,
  unauthorizedJson,
  validateApiKeyPermission,
  validateCsrfForSessionAuth,
} from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";
import type { TodoStatus } from "@/lib/types";

const MAX_NOTES_LENGTH = 4_000;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ todoId: string }> },
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
  const todoId = resolvedParams.todoId?.trim();

  if (!todoId || todoId.length > 64) {
    return NextResponse.json({ error: "Invalid todo id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    status?: unknown;
    dueDate?: unknown;
    estimatedHours?: unknown;
    timeBlockStart?: unknown;
    recurrence?: unknown;
    priority?: unknown;
    title?: unknown;
    notes?: unknown;
  } | null;

  const status = body?.status;
  const dueDate = body?.dueDate;
  const estimatedHours = body?.estimatedHours;
  const timeBlockStart = body?.timeBlockStart;
  const recurrence = body?.recurrence;
  const priority = body?.priority;
  const title = body?.title;
  const notes = body?.notes;

  const hasStatus = status === "open" || status === "done";
  const hasSchedule =
    dueDate !== undefined ||
    estimatedHours !== undefined ||
    timeBlockStart !== undefined ||
    recurrence !== undefined ||
    priority !== undefined;
  const hasTitle = title !== undefined;
  const hasNotes = notes !== undefined;

  if (!hasStatus && !hasSchedule && !hasTitle && !hasNotes) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  if (hasStatus) {
    await convex.mutation(api.todos.updateStatus, {
      todoId: todoId as never,
      status: status as TodoStatus,
    });
  }

  if (hasSchedule) {
    const normalizedRecurrence =
      recurrence === "daily" ||
      recurrence === "weekly" ||
      recurrence === "monthly" ||
      recurrence === "none" ||
      recurrence === undefined
        ? recurrence
        : null;

    if (normalizedRecurrence === null) {
      return NextResponse.json({ error: "Invalid recurrence value." }, { status: 400 });
    }

    const normalizedPriority =
      priority === 1 || priority === 2 || priority === 3 || priority === undefined
        ? priority
        : null;

    if (normalizedPriority === null) {
      return NextResponse.json({ error: "Invalid priority value." }, { status: 400 });
    }

    const normalizedDueDate =
      dueDate === null || dueDate === undefined
        ? null
        : typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
          ? Date.parse(`${dueDate}T00:00:00.000Z`)
          : null;
    const normalizedEstimatedHours =
      estimatedHours === null || estimatedHours === undefined
        ? null
        : typeof estimatedHours === "number" &&
            Number.isFinite(estimatedHours) &&
            estimatedHours >= 0.25 &&
            estimatedHours <= 24
          ? Math.round(estimatedHours * 4) / 4
          : null;
    const normalizedTimeBlockStart =
      timeBlockStart === null || timeBlockStart === undefined
        ? null
        : typeof timeBlockStart === "number" &&
            Number.isFinite(timeBlockStart) &&
            timeBlockStart > 0
          ? timeBlockStart
          : null;

    if (dueDate !== null && dueDate !== undefined && normalizedDueDate === null) {
      return NextResponse.json({ error: "Invalid due date." }, { status: 400 });
    }

    if (
      estimatedHours !== null &&
      estimatedHours !== undefined &&
      normalizedEstimatedHours === null
    ) {
      return NextResponse.json({ error: "Invalid estimated hours." }, { status: 400 });
    }

    if (
      timeBlockStart !== null &&
      timeBlockStart !== undefined &&
      normalizedTimeBlockStart === null
    ) {
      return NextResponse.json({ error: "Invalid time block start." }, { status: 400 });
    }

    await convex.mutation(api.todos.updateSchedule, {
      todoId: todoId as never,
      ...(dueDate !== undefined ? { dueDate: normalizedDueDate } : {}),
      ...(estimatedHours !== undefined
        ? { estimatedHours: normalizedEstimatedHours }
        : {}),
      ...(timeBlockStart !== undefined
        ? { timeBlockStart: normalizedTimeBlockStart }
        : {}),
      ...(recurrence !== undefined
        ? { recurrence: normalizedRecurrence as "none" | "daily" | "weekly" | "monthly" }
        : {}),
      ...(priority !== undefined
        ? { priority: normalizedPriority as 1 | 2 | 3 }
        : {}),
    });
  }

  if (hasTitle) {
    const normalizedTitle =
      typeof title === "string" ? title.trim().slice(0, 140) : "";

    if (!normalizedTitle) {
      return NextResponse.json({ error: "Todo title is required." }, { status: 400 });
    }

    await convex.mutation(api.todos.updateTitle, {
      todoId: todoId as never,
      title: normalizedTitle,
    });
  }

  if (hasNotes) {
    const normalizedNotes =
      notes === null
        ? null
        : typeof notes === "string"
          ? notes.trim().slice(0, MAX_NOTES_LENGTH) || null
          : null;

    if (notes !== null && typeof notes !== "string") {
      return NextResponse.json({ error: "Invalid notes value." }, { status: 400 });
    }

    await convex.mutation(api.todos.updateFromAgent, {
      todoId: todoId as never,
      notes: normalizedNotes,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ todoId: string }> },
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
  const todoId = resolvedParams.todoId?.trim();

  if (!todoId || todoId.length > 64) {
    return NextResponse.json({ error: "Invalid todo id." }, { status: 400 });
  }

  await convex.mutation(api.todos.deleteOneByStringId, {
    todoId,
  });

  return NextResponse.json({ ok: true });
}
