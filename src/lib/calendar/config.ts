/**
 * Calendar connection settings — the org-configurable business rules
 * (working days/hours, slot size, lookahead, minimum notice). Stored in
 * `organization_calendar_connections.settings` (jsonb), validated in app code
 * exactly like `whatsapp_connections.metadata`. Pure, no I/O.
 */

import type { WorkingHours } from "./availability.ts";

export interface CalendarSettings {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  /** Minutes since local midnight. */
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  lookaheadDays: number;
  minNoticeMinutes: number;
}

/** Sun–Thu 09:00–17:00, Asia/Riyadh, 30-minute slots, 14 days out, 2h notice. */
export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  timezone: "Asia/Riyadh",
  workingDays: [0, 1, 2, 3, 4],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  slotMinutes: 30,
  lookaheadDays: 14,
  minNoticeMinutes: 120,
};

export const LIMITS = {
  minSlotMinutes: 10,
  maxSlotMinutes: 240,
  minLookaheadDays: 1,
  maxLookaheadDays: 60,
  minNoticeMinutesMax: 10_080, // 7 days
};

function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function intOr(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Merge a partial/untrusted object over the defaults — never throws. */
export function parseCalendarSettings(raw: unknown): CalendarSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CALENDAR_SETTINGS;

  const workingDays = Array.isArray(r.workingDays)
    ? r.workingDays
        .map((x) => intOr(x, -1))
        .filter((x) => x >= 0 && x <= 6)
    : d.workingDays;

  return {
    timezone: isValidTimeZone(r.timezone) ? r.timezone : d.timezone,
    workingDays: workingDays.length > 0 ? [...new Set(workingDays)].sort() : d.workingDays,
    startMinute: clamp(intOr(r.startMinute, d.startMinute), 0, 23 * 60 + 59),
    endMinute: clamp(intOr(r.endMinute, d.endMinute), 1, 24 * 60),
    slotMinutes: clamp(
      intOr(r.slotMinutes, d.slotMinutes),
      LIMITS.minSlotMinutes,
      LIMITS.maxSlotMinutes,
    ),
    lookaheadDays: clamp(
      intOr(r.lookaheadDays, d.lookaheadDays),
      LIMITS.minLookaheadDays,
      LIMITS.maxLookaheadDays,
    ),
    minNoticeMinutes: clamp(
      intOr(r.minNoticeMinutes, d.minNoticeMinutes),
      0,
      LIMITS.minNoticeMinutesMax,
    ),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export interface SettingsValidation {
  ok: boolean;
  /** Dotted `calendar.validation.*` dictionary keys. */
  errors: string[];
  clean: CalendarSettings;
}

/** Validate a dashboard settings-form submission. */
export function validateCalendarSettingsInput(raw: {
  timezone?: unknown;
  workingDays?: unknown;
  startMinute?: unknown;
  endMinute?: unknown;
  slotMinutes?: unknown;
  lookaheadDays?: unknown;
  minNoticeMinutes?: unknown;
}): SettingsValidation {
  const errors: string[] = [];

  if (!isValidTimeZone(raw.timezone)) errors.push("calendar.validation.timezoneInvalid");

  const days = Array.isArray(raw.workingDays)
    ? raw.workingDays.map((x) => intOr(x, -1))
    : [];
  if (days.length === 0 || days.some((d) => d < 0 || d > 6)) {
    errors.push("calendar.validation.workingDaysInvalid");
  }

  const start = intOr(raw.startMinute, -1);
  const end = intOr(raw.endMinute, -1);
  if (start < 0 || start > 23 * 60 + 59) errors.push("calendar.validation.startTimeInvalid");
  if (end < 1 || end > 24 * 60) errors.push("calendar.validation.endTimeInvalid");
  if (start >= 0 && end >= 0 && end <= start) {
    errors.push("calendar.validation.endBeforeStart");
  }

  const slot = intOr(raw.slotMinutes, -1);
  if (slot < LIMITS.minSlotMinutes || slot > LIMITS.maxSlotMinutes) {
    errors.push("calendar.validation.slotMinutesInvalid");
  }

  const lookahead = intOr(raw.lookaheadDays, -1);
  if (lookahead < LIMITS.minLookaheadDays || lookahead > LIMITS.maxLookaheadDays) {
    errors.push("calendar.validation.lookaheadInvalid");
  }

  const notice = intOr(raw.minNoticeMinutes, -1);
  if (notice < 0 || notice > LIMITS.minNoticeMinutesMax) {
    errors.push("calendar.validation.minNoticeInvalid");
  }

  return { ok: errors.length === 0, errors, clean: parseCalendarSettings(raw) };
}

export function toWorkingHours(settings: CalendarSettings): WorkingHours {
  return {
    timezone: settings.timezone,
    workingDays: settings.workingDays,
    startMinute: settings.startMinute,
    endMinute: settings.endMinute,
  };
}
