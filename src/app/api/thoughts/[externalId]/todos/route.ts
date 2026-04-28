import { NextRequest, NextResponse } from "next/server";

import {
  getRouteAuth,
  unauthorizedJson,
  validateApiKeyPermission,
  validateCsrfForSessionAuth,
} from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function getExternalId(params: { externalId: string }) {
  const externalId = params.externalId?.trim();
  if (!externalId || externalId.length > 64) {
    return null;
  }

  return externalId;
}

function parseTodayStartUtc(today: string | null | undefined) {
  if (today && DATE_KEY_REGEX.test(today)) {
    const parsed = Date.parse(`${today}T00:00:00.000Z`);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export async function GET(
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

  const todayStartUtc = parseTodayStartUtc(request.nextUrl.searchParams.get("today"));
  if (todayStartUtc !== null) {
    await convex.mutation(api.todos.enforceDueDatesAndReschedule, { todayStartUtc });
  }

  const thought = await convex.query(api.thoughts.getByExternalId, { externalId });
  if (!thought) {
    return NextResponse.json({ todos: [] });
  }

  const todos = await convex.query(api.todos.byThought, {
    thoughtId: thought._id,
  });

  return NextResponse.json({
    todos: todos.map((todo) => ({
      id: todo._id,
      thoughtId: externalId,
      title: todo.title,
      notes: todo.notes,
      status: todo.status,
      dueDate: todo.dueDate ?? null,
      estimatedHours:
        typeof todo.estimatedHours === "number" ? todo.estimatedHours : null,
      timeBlockStart:
        typeof todo.timeBlockStart === "number" ? todo.timeBlockStart : null,
      priority: todo.priority ?? 2,
      recurrence: todo.recurrence ?? "none",
      source: todo.source ?? "manual",
      createdAt: todo.createdAt,
    })),
  });
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

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    notes?: unknown;
    dueDate?: unknown;
    estimatedHours?: unknown;
    timeBlockStart?: unknown;
    recurrence?: unknown;
  } | null;

  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 140) : "";
  const notes =
    typeof body?.notes === "string" ? body.notes.trim().slice(0, 4000) || null : null;
  const dueDateInput = typeof body?.dueDate === "string" ? body.dueDate.trim() : null;
  const recurrenceInput = typeof body?.recurrence === "string" ? body.recurrence : "none";
  const estimatedHoursInput = body?.estimatedHours;
  const timeBlockStartInput = body?.timeBlockStart;
  const recurrence =
    recurrenceInput === "daily" ||
    recurrenceInput === "weekly" ||
    recurrenceInput === "monthly" ||
    recurrenceInput === "none"
      ? recurrenceInput
      : "none";

  const dueDate =
    dueDateInput && /^\d{4}-\d{2}-\d{2}$/.test(dueDateInput)
      ? Date.parse(`${dueDateInput}T00:00:00.000Z`)
      : null;
  const estimatedHours =
    typeof estimatedHoursInput === "number" &&
    Number.isFinite(estimatedHoursInput) &&
    estimatedHoursInput >= 0.25 &&
    estimatedHoursInput <= 24
      ? Math.round(estimatedHoursInput * 4) / 4
      : null;
  const timeBlockStart =
    typeof timeBlockStartInput === "number" &&
    Number.isFinite(timeBlockStartInput) &&
    timeBlockStartInput > 0
      ? timeBlockStartInput
      : null;

  if (
    estimatedHoursInput !== undefined &&
    estimatedHoursInput !== null &&
    estimatedHours === null
  ) {
    return NextResponse.json({ error: "Invalid estimated hours." }, { status: 400 });
  }

  if (
    timeBlockStartInput !== undefined &&
    timeBlockStartInput !== null &&
    timeBlockStart === null
  ) {
    return NextResponse.json({ error: "Invalid time block start." }, { status: 400 });
  }

  if (!title) {
    return NextResponse.json({ error: "Todo title is required." }, { status: 400 });
  }

  const thought = await convex.query(api.thoughts.getByExternalId, { externalId });
  if (!thought) {
    return NextResponse.json({ error: "Thought not found." }, { status: 404 });
  }

  await convex.mutation(api.todos.createOne, {
    thoughtId: thought._id,
    thoughtExternalId: thought.externalId,
    title,
    notes,
    dueDate,
    estimatedHours,
    timeBlockStart,
    recurrence,
    source: "manual",
  });

  return NextResponse.json({ ok: true });
}
