import { NextRequest, NextResponse } from "next/server";

import {
  getRouteAuth,
  unauthorizedJson,
  validateApiKeyPermission,
} from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseTodayStartUtc(today: string | null | undefined) {
  if (today && DATE_KEY_REGEX.test(today)) {
    const parsed = Date.parse(`${today}T00:00:00.000Z`);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const auth = await getRouteAuth(request);
  if (!auth) {
    return unauthorizedJson();
  }
  const permissionError = validateApiKeyPermission(request, auth);
  if (permissionError) {
    return permissionError;
  }

  const todayStartUtc = parseTodayStartUtc(request.nextUrl.searchParams.get("today"));
  if (todayStartUtc !== null) {
    await convex.mutation(api.todos.enforceDueDatesAndReschedule, {
      todayStartUtc,
    });
  }

  const todos = await convex.query(api.todos.listAll, {});

  return NextResponse.json({
    todos: todos.map((todo) => ({
      id: todo._id,
      thoughtId: todo.thoughtExternalId ?? String(todo.thoughtId),
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
