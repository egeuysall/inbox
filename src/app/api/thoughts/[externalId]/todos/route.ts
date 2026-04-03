import { NextRequest, NextResponse } from "next/server";

import { getRouteSession, unauthorizedJson } from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";

function getExternalId(params: { externalId: string }) {
  const externalId = params.externalId?.trim();
  if (!externalId || externalId.length > 64) {
    return null;
  }

  return externalId;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ externalId: string }> },
) {
  const session = await getRouteSession(request);
  if (!session) {
    return unauthorizedJson();
  }

  const resolvedParams = await params;
  const externalId = getExternalId(resolvedParams);

  if (!externalId) {
    return NextResponse.json({ error: "Invalid thought id." }, { status: 400 });
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
  const session = await getRouteSession(request);
  if (!session) {
    return unauthorizedJson();
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
    recurrence?: unknown;
  } | null;

  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 140) : "";
  const notes =
    typeof body?.notes === "string" ? body.notes.trim().slice(0, 1200) || null : null;
  const dueDateInput = typeof body?.dueDate === "string" ? body.dueDate.trim() : null;
  const recurrenceInput = typeof body?.recurrence === "string" ? body.recurrence : "none";
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
    recurrence,
    source: "manual",
  });

  return NextResponse.json({ ok: true });
}
