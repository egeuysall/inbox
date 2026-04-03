import { NextRequest, NextResponse } from "next/server";

import { api, convex } from "@/lib/convex-server";
import {
  SESSION_COOKIE_NAME,
  hashSessionToken,
  sessionCookieOptions,
} from "@/lib/session";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await convex.mutation(api.sessions.remove, {
      tokenHash: hashSessionToken(token),
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieOptions(),
    maxAge: 0,
  });

  return response;
}
