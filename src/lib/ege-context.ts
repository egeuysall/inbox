import "server-only";

const AGENTS_JSON_URL = "https://egeuysal.com/agents.json";

const FALLBACK_CONTEXT = `Ege Uysal is a founder in Chicago (America/Chicago) building Ryva, an early-stage B2B SaaS product for small dev teams.
Ryva focus: convert first-run curiosity into second-run habit and then third-run dependency.
Current GTM channels: Reddit, X, LinkedIn.
Positioning: standups are a symptom of invisible project state; context visibility is the core value.
Execution style: depth over scale, action-first output, minimal fluff.`;

function clamp(text: string, maxLength: number) {
  return text.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function fromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return FALLBACK_CONTEXT;
  }

  const profile = Reflect.get(payload, "profile");
  const operator = Reflect.get(payload, "operator");
  const context = Reflect.get(payload, "context");

  const name = typeof Reflect.get(profile, "name") === "string" ? Reflect.get(profile, "name") : "Ege";
  const role = typeof Reflect.get(profile, "role") === "string" ? Reflect.get(profile, "role") : "Founder";
  const timezone =
    typeof Reflect.get(profile, "timezone") === "string"
      ? Reflect.get(profile, "timezone")
      : "America/Chicago";
  const description =
    typeof Reflect.get(profile, "description") === "string"
      ? Reflect.get(profile, "description")
      : "";
  const focus =
    typeof Reflect.get(operator, "focus") === "string"
      ? Reflect.get(operator, "focus")
      : "interest_to_repeated_usage";
  const worldview = Array.isArray(Reflect.get(operator, "worldview"))
    ? (Reflect.get(operator, "worldview") as unknown[])
        .filter((item): item is string => typeof item === "string")
        .slice(0, 4)
    : [];
  const recurringTags = Array.isArray(Reflect.get(context, "recurringTags"))
    ? (Reflect.get(context, "recurringTags") as unknown[])
        .filter((item): item is string => typeof item === "string")
        .slice(0, 8)
    : [];

  const worldviewText = worldview.length > 0 ? worldview.join("; ") : "context-first execution";
  const tagText = recurringTags.length > 0 ? recurringTags.join(", ") : "execution, product, gtm";

  return clamp(
    `${name} (${role}) in ${timezone}. ${description}. Current focus: ${focus}. Worldview: ${worldviewText}. Recurring themes: ${tagText}.`,
    1500,
  );
}

export async function getEgeContext() {
  try {
    const response = await fetch(AGENTS_JSON_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return FALLBACK_CONTEXT;
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    return fromPayload(payload);
  } catch {
    return FALLBACK_CONTEXT;
  }
}

