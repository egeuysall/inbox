import { NextRequest, NextResponse } from "next/server";

import {
  getRouteAuth,
  unauthorizedJson,
  validateApiKeyPermission,
  validateCsrfForSessionAuth,
} from "@/lib/auth-server";
import { createCalendarFeedToken } from "@/lib/calendar-feed";
import { api, convex } from "@/lib/convex-server";

const CALENDAR_FEED_PREFIX = "icf";
const CALENDAR_FEED_NAME = "calendar-feed";

function getRequestOrigin(request: NextRequest) {
  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!hostHeader) {
    return null;
  }

  const protocolHeader = request.headers.get("x-forwarded-proto");
  const protocol =
    protocolHeader?.split(",")[0]?.trim() ||
    (process.env.NODE_ENV === "production" ? "https" : "http");

  if (protocol !== "http" && protocol !== "https") {
    return null;
  }

  return `${protocol}://${hostHeader.trim()}`;
}

export async function GET(request: NextRequest) {
  const auth = await getRouteAuth(request);
  if (!auth) {
    return unauthorizedJson();
  }
  const permissionError = validateApiKeyPermission(request, auth);
  if (permissionError) {
    return permissionError;
  }

  const keys = await convex.query(api.apiKeys.list, { includeRevoked: false });
  const activeFeed =
    keys.find((key) => key.prefix === CALENDAR_FEED_PREFIX) ?? null;

  return NextResponse.json({
    activeFeed: activeFeed
      ? {
          id: activeFeed._id,
          name: activeFeed.name,
          prefix: activeFeed.prefix,
          last4: activeFeed.last4,
          createdAt: activeFeed.createdAt,
        }
      : null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await getRouteAuth(request);
  if (!auth) {
    return unauthorizedJson();
  }
  const permissionError = validateApiKeyPermission(request, auth);
  if (permissionError) {
    return permissionError;
  }

  const csrfError = validateCsrfForSessionAuth(request, auth);
  if (csrfError) {
    return csrfError;
  }

  const keys = await convex.query(api.apiKeys.list, { includeRevoked: false });
  const existingFeeds = keys.filter((key) => key.prefix === CALENDAR_FEED_PREFIX);

  await Promise.all(
    existingFeeds.map((feed) =>
      convex.mutation(api.apiKeys.revoke, {
        keyId: feed._id,
      }),
    ),
  );

  const { rawToken, keyHash, last4, prefix } = createCalendarFeedToken();

  const keyId = await convex.mutation(api.apiKeys.create, {
    name: CALENDAR_FEED_NAME,
    keyHash,
    prefix,
    last4,
    permission: "read",
  });

  const origin = getRequestOrigin(request);
  if (!origin) {
    return NextResponse.json(
      { error: "Could not determine request origin." },
      { status: 500 },
    );
  }

  const feedUrl = `${origin}/api/calendar/ics?token=${encodeURIComponent(rawToken)}`;

  return NextResponse.json({
    ok: true,
    feedUrl,
    feed: {
      id: keyId,
      name: CALENDAR_FEED_NAME,
      prefix,
      last4,
      createdAt: Date.now(),
    },
  });
}
