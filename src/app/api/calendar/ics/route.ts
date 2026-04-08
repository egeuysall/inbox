import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { api, convex } from "@/lib/convex-server";
import type { TodoRecurrence } from "@/lib/types";

const CALENDAR_FEED_PREFIX = "icf";
const FEED_TOKEN_REGEX = /^icf_[A-Za-z0-9_-]{16,}$/;
const USER_TIMEZONE = "America/Chicago";
const DEFAULT_EVENT_HOURS = 1;
const ICS_LINE_LIMIT = 74;

function toIcsUtcDateTime(timestamp: number) {
  return new Date(timestamp)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line: string) {
  if (line.length <= ICS_LINE_LIMIT) {
    return line;
  }

  const segments: string[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    const chunk = line.slice(cursor, cursor + ICS_LINE_LIMIT);
    if (cursor === 0) {
      segments.push(chunk);
    } else {
      segments.push(` ${chunk}`);
    }
    cursor += ICS_LINE_LIMIT;
  }

  return segments.join("\r\n");
}

function normalizeEstimatedHours(hours: number | null | undefined) {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
    return DEFAULT_EVENT_HOURS;
  }

  return Math.max(0.25, Math.min(24, Math.round(hours * 4) / 4));
}

function recurrenceToRrule(recurrence: TodoRecurrence) {
  if (recurrence === "daily") {
    return "FREQ=DAILY";
  }

  if (recurrence === "weekly") {
    return "FREQ=WEEKLY";
  }

  if (recurrence === "monthly") {
    return "FREQ=MONTHLY";
  }

  return null;
}

function buildIcsBody(
  todos: Array<{
    _id: string;
    title: string;
    notes: string | null;
    priority?: number | null;
    estimatedHours?: number | null;
    timeBlockStart?: number | null;
    recurrence?: TodoRecurrence | null;
    createdAt: number;
  }>,
) {
  const nowStamp = toIcsUtcDateTime(Date.now());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ibx//schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ibx schedule",
    `X-WR-TIMEZONE:${USER_TIMEZONE}`,
  ];

  for (const todo of todos) {
    if (typeof todo.timeBlockStart !== "number" || todo.timeBlockStart <= 0) {
      continue;
    }

    const estimatedHours = normalizeEstimatedHours(todo.estimatedHours);
    const eventStart = todo.timeBlockStart;
    const eventEnd = Math.round(
      eventStart + estimatedHours * 60 * 60 * 1000,
    );
    const priority =
      todo.priority === 1 || todo.priority === 2 || todo.priority === 3
        ? todo.priority
        : 2;
    const recurrence = recurrenceToRrule(todo.recurrence ?? "none");
    const descriptionParts = [`p${priority}`, `hours ${estimatedHours}`];

    if (todo.notes && todo.notes.trim()) {
      descriptionParts.push(todo.notes.trim());
    }

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:ibx-todo-${escapeIcsText(todo._id)}@ibx.local`);
    lines.push(`DTSTAMP:${nowStamp}`);
    lines.push(`DTSTART:${toIcsUtcDateTime(eventStart)}`);
    lines.push(`DTEND:${toIcsUtcDateTime(eventEnd)}`);
    lines.push(`SUMMARY:${escapeIcsText(todo.title)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(descriptionParts.join(" // "))}`);
    if (recurrence) {
      lines.push(`RRULE:${recurrence}`);
    }
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:OPAQUE");
    lines.push(`CREATED:${toIcsUtcDateTime(todo.createdAt)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!FEED_TOKEN_REGEX.test(token)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const keyHash = createHash("sha256").update(token).digest("hex");
  const key = await convex.query(api.apiKeys.getActiveByHash, { keyHash });

  if (!key || key.prefix !== CALENDAR_FEED_PREFIX) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const todos = await convex.query(api.todos.listAll, {});
  const openScheduledTodos = todos
    .filter((todo) => todo.status === "open")
    .sort((left, right) => {
      const leftStart = left.timeBlockStart ?? Number.MAX_SAFE_INTEGER;
      const rightStart = right.timeBlockStart ?? Number.MAX_SAFE_INTEGER;
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      return right.createdAt - left.createdAt;
    });

  const body = buildIcsBody(openScheduledTodos);
  const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control":
          "public, max-age=300, s-maxage=7200, stale-while-revalidate=7200",
      },
    });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="ibx-schedule.ics"',
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control":
        "public, max-age=300, s-maxage=7200, stale-while-revalidate=7200",
      "X-PUBLISHED-TTL": "PT2H",
    },
  });
}
