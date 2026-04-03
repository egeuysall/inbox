import { NextRequest, NextResponse } from "next/server";

import { api, convex } from "@/lib/convex-server";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  hashSessionToken,
  isValidPassword,
  sessionCookieOptions,
} from "@/lib/session";

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = payload?.password;

  if (typeof password !== "string" || password.length === 0 || password.length > 512) {
    return NextResponse.json({ error: "Invalid password." }, { status: 400 });
  }

  if (!isValidPassword(password)) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;

  await convex.mutation(api.sessions.upsert, {
    tokenHash,
    expiresAt,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...sessionCookieOptions(),
    expires: new Date(expiresAt),
  });

  return response;
}
