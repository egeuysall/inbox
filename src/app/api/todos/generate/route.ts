import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { generateTodosFromThought } from "@/lib/ai";
import { getRouteSession, unauthorizedJson } from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";
import { getEgeContext } from "@/lib/ege-context";

function normalizeInputText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().slice(0, 8_000);
  return normalized.length ? normalized : null;
}

export async function POST(request: NextRequest) {
  const session = await getRouteSession(request);
  if (!session) {
    return unauthorizedJson();
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const rawText = normalizeInputText(body?.text);

  if (!rawText) {
    return NextResponse.json({ error: "Input is required." }, { status: 400 });
  }

  const externalId = randomUUID();
  const aiRunId = randomUUID();
  const createdAt = Date.now();

  await convex.mutation(api.thoughts.upsert, {
    externalId,
    rawText,
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

    const generatedTodos = await generateTodosFromThought(rawText, {
      profileContext,
      recentRunMemories: recentRunMemories.map((memory) => memory.content),
    });

    const thought = await convex.query(api.thoughts.getByExternalId, { externalId });
    if (!thought) {
      return NextResponse.json({ error: "Thought was not created." }, { status: 500 });
    }

    if (generatedTodos.length > 0) {
      await convex.mutation(api.todos.createMany, {
        thoughtId: thought._id,
        thoughtExternalId: externalId,
        items: generatedTodos.map((todo) => ({
          title: todo.title,
          notes: todo.notes,
          dueDate: todo.dueDate ? Date.parse(`${todo.dueDate}T00:00:00.000Z`) : null,
          recurrence: todo.recurrence,
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
      content: `input="${rawText.slice(0, 240)}" created=${generatedTodos.length} todos titles=[${generatedTodos
        .map((todo) => todo.title)
        .slice(0, 6)
        .join(" | ")}]`,
    });

    return NextResponse.json({
      ok: true,
      runId: externalId,
      created: generatedTodos.length,
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
      content: `input="${rawText.slice(0, 240)}" failed="${message.slice(0, 220)}"`,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
