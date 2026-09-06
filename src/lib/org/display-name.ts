import type { User } from "@supabase/supabase-js";

/**
 * A friendly name for the dashboard greeting. Prefers a real name from the
 * user's auth metadata; falls back to a tidied first token of the email local
 * part. Never returns a full email address. May be `""` — the caller should
 * greet without a name in that case.
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
        : "";
  const firstOfFull = full.trim().split(/\s+/).filter(Boolean)[0];
  if (firstOfFull) return firstOfFull;

  const local = (user.email ?? "").split("@")[0] ?? "";
  const token = local.split(/[._+-]+/).filter(Boolean)[0] ?? "";
  if (!token) return "";
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
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
