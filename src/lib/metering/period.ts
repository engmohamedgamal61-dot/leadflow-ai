/**
 * Billing-period boundaries. Pure, dependency-free, deterministic.
 *
 * Usage windows ("today", "this month", "last month") are calendar periods in a
 * fixed billing timezone — LeadFlow's primary market is Saudi Arabia, matching
 * the Calendar/WhatsApp default of `Asia/Riyadh`. Every boundary is returned as
 * a half-open `[startIso, endIso)` UTC instant range so it drops straight into
 * a `occurred_at >= start and occurred_at < end` query.
 */

export const BILLING_TIME_ZONE = "Asia/Riyadh";

export interface InstantRange {
  /** Inclusive lower bound, ISO-8601 UTC. */
  startIso: string;
  /** Exclusive upper bound, ISO-8601 UTC. */
  endIso: string;
}

interface CivilTime {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock civil time for `date` in `timeZone`. */
function zonedParts(date: Date, timeZone: string): CivilTime {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const map: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/**
 * The UTC instant at which a given wall-clock civil time occurs in `timeZone`.
 * `Date.UTC` normalises out-of-range fields (e.g. day 32 → next month), so
 * callers can add days by just incrementing `day`. The zone offset (including
 * the rare DST boundary) is measured once and corrected.
 */
function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour ?? 0,
    wall.minute ?? 0,
    wall.second ?? 0,
  );
  const seen = zonedParts(new Date(naive), timeZone);
  const seenNaive = Date.UTC(
    seen.year,
    seen.month - 1,
    seen.day,
    seen.hour,
    seen.minute,
    seen.second,
  );
  return new Date(naive - (seenNaive - naive));
}

function zonedMidnight(
  parts: { year: number; month: number; day: number },
  timeZone: string,
): Date {
  return zonedTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** `[00:00 today, 00:00 tomorrow)` in the billing timezone. */
export function todayRange(
  now: Date = new Date(),
  timeZone: string = BILLING_TIME_ZONE,
): InstantRange {
  const p = zonedParts(now, timeZone);
  const start = zonedMidnight(p, timeZone);
  const end = zonedMidnight({ year: p.year, month: p.month, day: p.day + 1 }, timeZone);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** `[1st 00:00 this month, 1st 00:00 next month)` in the billing timezone. */
export function currentMonthRange(
  now: Date = new Date(),
  timeZone: string = BILLING_TIME_ZONE,
): InstantRange {
  const p = zonedParts(now, timeZone);
  const start = zonedMidnight({ year: p.year, month: p.month, day: 1 }, timeZone);
  const end = zonedMidnight({ year: p.year, month: p.month + 1, day: 1 }, timeZone);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** The calendar month before {@link currentMonthRange}. */
export function previousMonthRange(
  now: Date = new Date(),
  timeZone: string = BILLING_TIME_ZONE,
): InstantRange {
  const p = zonedParts(now, timeZone);
  const start = zonedMidnight({ year: p.year, month: p.month - 1, day: 1 }, timeZone);
  const end = zonedMidnight({ year: p.year, month: p.month, day: 1 }, timeZone);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * The local calendar date (`YYYY-MM-DD`) for an instant, in the billing
 * timezone. Used to bucket usage rows into a daily trend.
 */
export function billingDateKey(
  iso: string,
  timeZone: string = BILLING_TIME_ZONE,
): string {
  const p = zonedParts(new Date(iso), timeZone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

/**
 * Every `YYYY-MM-DD` key from `range.startIso` up to (not including)
 * `range.endIso`, in billing-timezone calendar order.
 */
export function dateKeysInRange(
  range: InstantRange,
  timeZone: string = BILLING_TIME_ZONE,
): string[] {
  const keys: string[] = [];
  const endMs = new Date(range.endIso).getTime();
  let civil = zonedParts(new Date(range.startIso), timeZone);
  for (let guard = 0; guard < 400; guard += 1) {
    const midnight = zonedMidnight(civil, timeZone);
    if (midnight.getTime() >= endMs) break;
    keys.push(billingDateKey(midnight.toISOString(), timeZone));
    civil = zonedParts(
      zonedTimeToUtc({ ...civil, day: civil.day + 1, hour: 12 }, timeZone),
      timeZone,
    );
  }
  return keys;
}
