/**
 * Pure, deterministic slot computation. No I/O, no provider, no Supabase —
 * given working hours, real busy intervals (from the provider), and timing
 * rules, it produces the exact list of bookable slots. This is what makes "the
 * AI never invents availability" true: the AI is only ever shown output of
 * this function.
 */

import type { BusyInterval, TimeSlot } from "./provider.ts";

/** 0 = Sunday … 6 = Saturday (JS/Intl convention). */
export interface WorkingHours {
  timezone: string;
  workingDays: readonly number[];
  /** Minutes since local midnight, e.g. 9:00 → 540. */
  startMinute: number;
  /** Minutes since local midnight, e.g. 17:00 → 1020. */
  endMinute: number;
}

export interface AvailabilityInput {
  workingHours: WorkingHours;
  /** Real busy intervals from the provider — anything else is assumed free. */
  busy: readonly BusyInterval[];
  /** How many calendar days ahead (in the working timezone) to consider. */
  lookaheadDays: number;
  slotMinutes: number;
  /** A slot cannot start sooner than this many ms from `now`. */
  minNoticeMs: number;
  now: Date;
  /** Safety cap on returned slots (a very open calendar shouldn't return thousands). */
  maxSlots?: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

/**
 * Read the calendar date + weekday `date` falls on, as displayed in
 * `timeZone`. Used only to pick which local calendar days are "working days";
 * the actual UTC instant for a slot is computed separately by
 * {@link zonedTimeToUtc}.
 */
function zonedDateParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const WEEKDAYS: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/**
 * The UTC instant at which the given local wall-clock time occurs in
 * `timeZone`. Re-derives the zone's offset from the actual rendered time so it
 * is DST-correct for zones that observe it (the product's default zone,
 * Asia/Riyadh, has no DST). Ambiguous/skipped clock times during a DST
 * transition are a known, documented limitation of this approach.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(guessMs)).map((x) => [x.type, x.value]),
  );
  const renderedAsUtcMs = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) === 24 ? 0 : Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  const offsetMs = renderedAsUtcMs - guessMs;
  return new Date(guessMs - offsetMs);
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Deterministic, pure availability computation. See module doc. */
export function computeAvailableSlots(input: AvailabilityInput): TimeSlot[] {
  const {
    workingHours,
    busy,
    lookaheadDays,
    slotMinutes,
    minNoticeMs,
    now,
    maxSlots = 200,
  } = input;

  if (slotMinutes <= 0 || lookaheadDays <= 0) return [];

  const earliestStartMs = now.getTime() + minNoticeMs;
  const busyMs = busy.map((b) => ({
    start: Date.parse(b.startsAt),
    end: Date.parse(b.endsAt),
  }));

  const slots: TimeSlot[] = [];
  const workingDaySet = new Set(workingHours.workingDays);

  for (let dayOffset = 0; dayOffset <= lookaheadDays; dayOffset++) {
    if (slots.length >= maxSlots) break;
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const { year, month, day, weekday } = zonedDateParts(
      probe,
      workingHours.timezone,
    );
    if (!workingDaySet.has(weekday)) continue;

    for (
      let minute = workingHours.startMinute;
      minute + slotMinutes <= workingHours.endMinute;
      minute += slotMinutes
    ) {
      if (slots.length >= maxSlots) break;
      const slotStart = zonedTimeToUtc(
        year,
        month,
        day,
        Math.floor(minute / 60),
        minute % 60,
        workingHours.timezone,
      );
      const startMs = slotStart.getTime();
      const endMs = startMs + slotMinutes * 60_000;
      if (startMs < earliestStartMs) continue;
      if (busyMs.some((b) => overlaps(startMs, endMs, b.start, b.end))) {
        continue;
      }
      slots.push({
        startsAt: slotStart.toISOString(),
        endsAt: new Date(endMs).toISOString(),
      });
    }
  }

  return slots;
}

/** Is `slot` still free against `busy`? Used to re-validate at booking time. */
export function isSlotFree(
  slot: TimeSlot,
  busy: readonly BusyInterval[],
): boolean {
  const start = Date.parse(slot.startsAt);
  const end = Date.parse(slot.endsAt);
  return !busy.some((b) =>
    overlaps(start, end, Date.parse(b.startsAt), Date.parse(b.endsAt)),
  );
}
