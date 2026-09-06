import type { User } from "@supabase/supabase-js";

/** Generic mailbox names that aren't a person — never greet with these. */
const GENERIC_LOCAL_PARTS = new Set([
  "admin",
  "info",
  "hello",
  "hi",
  "team",
  "sales",
  "support",
  "contact",
  "office",
  "billing",
  "accounts",
  "no-reply",
  "noreply",
  "mail",
  "email",
  "user",
  "users",
  "test",
  "testing",
  "qa",
  "demo",
  "owner",
  "admin",
  "administrator",
  "manager",
  "member",
  "viewer",
  "staff",
  "agent",
  "dev",
  "developer",
  "help",
  "service",
  "root",
  "me",
  "you",
]);

function titleCase(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** A single clean name token, or "" if the source doesn't yield a real name. */
function nameFromToken(raw: string): string {
  const token = raw.trim();
  // Reject anything with digits, too short/long, or a generic mailbox word.
  if (!/^[\p{L}]{2,20}$/u.test(token)) return "";
  if (GENERIC_LOCAL_PARTS.has(token.toLowerCase())) return "";
  return titleCase(token);
}

/**
 * A friendly first name for the dashboard greeting. Prefers a real name from
 * the user's auth metadata; falls back to the first token of the email local
 * part *only* when it looks like an actual name. Returns "" when there's
 * nothing sensible — the caller then greets without a name rather than showing
 * something like "Engmohamedgamal61" or "Qa".
 */
export function resolveDisplayName(
  user: Pick<User, "email" | "user_metadata">,
): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const full =
    typeof meta.full_name === "string"
      ? meta.full_name
      : typeof meta.name === "string"
        ? meta.name
        : typeof meta.first_name === "string"
          ? meta.first_name
          : "";
  const fromMeta = full.trim().split(/\s+/).filter(Boolean)[0];
  if (fromMeta) {
    const clean = nameFromToken(fromMeta);
    if (clean) return clean;
  }

  const local = (user.email ?? "").split("@")[0] ?? "";
  for (const token of local.split(/[._+-]+/).filter(Boolean)) {
    const clean = nameFromToken(token);
    if (clean) return clean;
  }
  return "";
}

export type GreetingPeriod = "morning" | "afternoon" | "evening";

/** Bucket the hour (0–23) into a greeting period. */
export function greetingPeriod(hour: number): GreetingPeriod {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/**
 * The current hour in the product's default business timezone (Asia/Riyadh —
 * the same default the calendar/booking settings use). Keeps the greeting
 * sensible regardless of where the server runs.
 */
export function currentBusinessHour(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "Asia/Riyadh",
  }).format(now);
  const hour = Number.parseInt(parts, 10);
  return Number.isFinite(hour) ? hour % 24 : now.getHours();
}
