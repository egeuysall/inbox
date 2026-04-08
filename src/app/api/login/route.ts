import { NextRequest, NextResponse } from "next/server";

import { api, convex } from "@/lib/convex-server";
import {
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  hashSessionToken,
  isValidPassword,
  sessionCookieOptions,
} from "@/lib/session";

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS_PER_WINDOW = 10;
const MAX_PASSWORD_LENGTH = 512;

type LoginAttemptBucket = {
  attempts: number;
  resetAt: number;
};

type LoginRateLimitStore = Map<string, LoginAttemptBucket>;

const globalForLoginRateLimit = globalThis as typeof globalThis & {
  __ibxLoginRateLimitStore?: LoginRateLimitStore;
};

function getLoginRateLimitStore() {
  if (!globalForLoginRateLimit.__ibxLoginRateLimitStore) {
    globalForLoginRateLimit.__ibxLoginRateLimitStore = new Map();
  }

  return globalForLoginRateLimit.__ibxLoginRateLimitStore;
}

function getClientAddress(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

function checkLoginRateLimit(clientAddress: string) {
  const store = getLoginRateLimitStore();
  const now = Date.now();
  const bucket = store.get(clientAddress);

  if (!bucket || bucket.resetAt <= now) {
    store.set(clientAddress, {
      attempts: 0,
      resetAt: now + LOGIN_WINDOW_MS,
    });
    return { limited: false, resetAt: now + LOGIN_WINDOW_MS };
  }

  if (bucket.attempts >= MAX_LOGIN_ATTEMPTS_PER_WINDOW) {
    return { limited: true, resetAt: bucket.resetAt };
  }

  return { limited: false, resetAt: bucket.resetAt };
}

function recordFailedLogin(clientAddress: string) {
  const store = getLoginRateLimitStore();
  const now = Date.now();
  const bucket = store.get(clientAddress);

  if (!bucket || bucket.resetAt <= now) {
    store.set(clientAddress, {
      attempts: 1,
      resetAt: now + LOGIN_WINDOW_MS,
    });
    return;
  }

  store.set(clientAddress, {
    attempts: bucket.attempts + 1,
    resetAt: bucket.resetAt,
  });
}

function clearLoginRateLimit(clientAddress: string) {
  getLoginRateLimitStore().delete(clientAddress);
}

export async function POST(request: NextRequest) {
  const clientAddress = getClientAddress(request);
  const rateLimit = checkLoginRateLimit(clientAddress);
  if (rateLimit.limited) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: "Too many attempts. Try again later.",
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      },
    );
  }

  const payload = (await request.json().catch(() => null)) as
    | { password?: unknown }
    | null;
  const password = payload?.password;

  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    recordFailedLogin(clientAddress);
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  if (!isValidPassword(password)) {
    recordFailedLogin(clientAddress);
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  clearLoginRateLimit(clientAddress);

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
  response.cookies.set({
    name: LEGACY_SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieOptions(),
    maxAge: 0,
  });

  return response;
}
