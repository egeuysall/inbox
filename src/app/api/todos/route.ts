import { NextRequest, NextResponse } from "next/server";

import { getRouteSession, unauthorizedJson } from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";

export async function GET(request: NextRequest) {
  const session = await getRouteSession(request);
  if (!session) {
    return unauthorizedJson();
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
      recurrence: todo.recurrence ?? "none",
      source: todo.source ?? "manual",
      createdAt: todo.createdAt,
    })),
  });
}
