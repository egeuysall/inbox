import { NextRequest, NextResponse } from "next/server";

import { getRouteSession } from "@/lib/auth-server";

export async function GET(request: NextRequest) {
  const session = await getRouteSession(request);

  if (!session) {
    return NextResponse.json({ authenticated: false, expiresAt: null });
  }

  return NextResponse.json({
    authenticated: true,
    expiresAt: session.expiresAt,
  });
}
