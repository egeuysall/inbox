import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const CALENDAR_FEED_TOKEN_PREFIX = "icf_";
const CALENDAR_FEED_TOKEN_BYTES = 24;

export function createCalendarFeedToken() {
  const token = randomBytes(CALENDAR_FEED_TOKEN_BYTES).toString("base64url");
  const rawToken = `${CALENDAR_FEED_TOKEN_PREFIX}${token}`;
  const keyHash = createHash("sha256").update(rawToken).digest("hex");
  const last4 = rawToken.slice(-4);

  return {
    rawToken,
    keyHash,
    last4,
    prefix: CALENDAR_FEED_TOKEN_PREFIX.slice(0, -1),
  };
}

