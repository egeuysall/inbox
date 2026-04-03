import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "mg_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

function secureCookiesEnabled() {
  if (process.env.SESSION_COOKIE_SECURE) {
    return process.env.SESSION_COOKIE_SECURE === "true";
  }

  return process.env.NODE_ENV === "production";
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookiesEnabled(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidPassword(inputPassword: string) {
  const configuredPassword = process.env.APP_ACCESS_PASSWORD;

  if (!configuredPassword) {
    throw new Error("APP_ACCESS_PASSWORD is required.");
  }

  const inputDigest = createHash("sha256").update(inputPassword).digest();
  const expectedDigest = createHash("sha256").update(configuredPassword).digest();

  return timingSafeEqual(inputDigest, expectedDigest);
}
