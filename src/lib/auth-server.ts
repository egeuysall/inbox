import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { api, convex } from "@/lib/convex-server";
import {
  SESSION_COOKIE_NAME,
  hashSessionToken,
  sessionCookieOptions,
} from "@/lib/session";

export type SessionCheck = {
  token: string;
  tokenHash: string;
  expiresAt: number;
};

async function resolveSession(token: string) {
  const tokenHash = hashSessionToken(token);
  const session = await convex.query(api.sessions.getValid, { tokenHash });

  if (!session) {
    return null;
  }

  return {
    token,
    tokenHash,
    expiresAt: session.expiresAt,
  } satisfies SessionCheck;
}

export async function getServerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return resolveSession(token);
}

export async function getRouteSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return resolveSession(token);
}

export function unauthorizedJson(message = "Unauthorized") {
  const response = NextResponse.json({ error: message }, { status: 401 });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
