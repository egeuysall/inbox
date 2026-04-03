import { NextRequest, NextResponse } from "next/server";

import { getRouteSession, unauthorizedJson } from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";
import type { TodoStatus } from "@/lib/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ todoId: string }> },
) {
  const session = await getRouteSession(request);
  if (!session) {
    return unauthorizedJson();
  }

  const resolvedParams = await params;
  const todoId = resolvedParams.todoId?.trim();

  if (!todoId || todoId.length > 64) {
    return NextResponse.json({ error: "Invalid todo id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    status?: unknown;
    dueDate?: unknown;
    recurrence?: unknown;
  } | null;

  const status = body?.status;
  const dueDate = body?.dueDate;
  const recurrence = body?.recurrence;

  const hasStatus = status === "open" || status === "done";
  const hasSchedule = dueDate !== undefined || recurrence !== undefined;

  if (!hasStatus && !hasSchedule) {
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

    const normalizedDueDate =
      dueDate === null || dueDate === undefined
        ? null
        : typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
          ? Date.parse(`${dueDate}T00:00:00.000Z`)
          : null;

    if (dueDate !== null && dueDate !== undefined && normalizedDueDate === null) {
      return NextResponse.json({ error: "Invalid due date." }, { status: 400 });
    }

    await convex.mutation(api.todos.updateSchedule, {
      todoId: todoId as never,
      ...(dueDate !== undefined ? { dueDate: normalizedDueDate } : {}),
      ...(recurrence !== undefined
        ? { recurrence: normalizedRecurrence as "none" | "daily" | "weekly" | "monthly" }
        : {}),
    });
  }

  return NextResponse.json({ ok: true });
}
