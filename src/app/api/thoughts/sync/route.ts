import { NextRequest, NextResponse } from "next/server";

import { getRouteSession, unauthorizedJson } from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";
import type { ThoughtStatus } from "@/lib/types";

const VALID_THOUGHT_STATUS = new Set<ThoughtStatus>([
  "pending",
  "processing",
  "done",
  "failed",
]);

type SyncThoughtBody = {
  externalId: string;
  rawText: string;
  createdAt: number;
  status: ThoughtStatus;
  aiRunId: string | null;
};

function sanitizeThought(value: unknown): SyncThoughtBody | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const externalId = Reflect.get(value, "externalId");
  const rawText = Reflect.get(value, "rawText");
  const createdAt = Reflect.get(value, "createdAt");
  const status = Reflect.get(value, "status");
  const aiRunId = Reflect.get(value, "aiRunId");

  if (typeof externalId !== "string" || externalId.length < 16 || externalId.length > 64) {
    return null;
  }

  if (typeof rawText !== "string") {
    return null;
  }

  const normalizedText = rawText.trim().slice(0, 12_000);
  if (!normalizedText) {
    return null;
  }

  if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt <= 0) {
    return null;
  }

  if (typeof status !== "string" || !VALID_THOUGHT_STATUS.has(status as ThoughtStatus)) {
    return null;
  }

  if (aiRunId !== null && typeof aiRunId !== "string") {
    return null;
  }

  return {
    externalId,
    rawText: normalizedText,
    createdAt,
    status: status as ThoughtStatus,
    aiRunId: aiRunId ? aiRunId.slice(0, 128) : null,
  };
}

export async function POST(request: NextRequest) {
  const session = await getRouteSession(request);
  if (!session) {
    return unauthorizedJson();
  }

  const payload = (await request.json().catch(() => null)) as { thoughts?: unknown } | null;
  const thoughts = Array.isArray(payload?.thoughts)
    ? payload.thoughts
        .map((thought) => sanitizeThought(thought))
        .filter((thought): thought is SyncThoughtBody => thought !== null)
    : [];

  if (thoughts.length === 0) {
    return NextResponse.json({ thoughts: [] });
  }

  await Promise.all(
    thoughts.map((thought) =>
      convex.mutation(api.thoughts.upsert, {
        externalId: thought.externalId,
        rawText: thought.rawText,
        createdAt: thought.createdAt,
        status: thought.status,
        synced: true,
        aiRunId: thought.aiRunId,
      }),
    ),
  );

  const syncedThoughts = await convex.query(api.thoughts.list, {});

  return NextResponse.json({
    thoughts: syncedThoughts.map((thought) => ({
      externalId: thought.externalId,
      rawText: thought.rawText,
      createdAt: thought.createdAt,
      status: thought.status,
      synced: thought.synced,
      aiRunId: thought.aiRunId,
    })),
  });
}
