import { NextRequest, NextResponse } from "next/server";

import { getRouteSession, unauthorizedJson } from "@/lib/auth-server";
import { api, convex } from "@/lib/convex-server";

export async function GET(request: NextRequest) {
  const session = await getRouteSession(request);
  if (!session) {
    return unauthorizedJson();
  }

  const thoughts = await convex.query(api.thoughts.list, {});

  return NextResponse.json({
    thoughts: thoughts.map((thought) => ({
      externalId: thought.externalId,
      rawText: thought.rawText,
      createdAt: thought.createdAt,
      status: thought.status,
      synced: thought.synced,
      aiRunId: thought.aiRunId,
    })),
  });
}
