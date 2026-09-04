import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CALENDAR_SETTINGS,
  LIMITS,
  parseCalendarSettings,
  toWorkingHours,
  validateCalendarSettingsInput,
} from "./config.ts";

test("parseCalendarSettings falls back to sane defaults for junk/missing input", () => {
  assert.deepEqual(parseCalendarSettings(undefined), DEFAULT_CALENDAR_SETTINGS);
  assert.deepEqual(parseCalendarSettings(null), DEFAULT_CALENDAR_SETTINGS);
  assert.deepEqual(parseCalendarSettings("nope"), DEFAULT_CALENDAR_SETTINGS);
  assert.deepEqual(parseCalendarSettings({ timezone: "Not/AZone" }).timezone, DEFAULT_CALENDAR_SETTINGS.timezone);
});

test("parseCalendarSettings clamps out-of-range values instead of rejecting", () => {
  const parsed = parseCalendarSettings({
    slotMinutes: 5, // below LIMITS.minSlotMinutes
    lookaheadDays: 9999, // above LIMITS.maxLookaheadDays
    minNoticeMinutes: -5,
  });
  assert.equal(parsed.slotMinutes, LIMITS.minSlotMinutes);
  assert.equal(parsed.lookaheadDays, LIMITS.maxLookaheadDays);
  assert.equal(parsed.minNoticeMinutes, 0);
});

test("parseCalendarSettings accepts a valid override wholesale", () => {
  const custom = {
    timezone: "Africa/Cairo",
    workingDays: [1, 2, 3, 4, 5],
    startMinute: 8 * 60,
    endMinute: 16 * 60,
    slotMinutes: 45,
    lookaheadDays: 21,
    minNoticeMinutes: 60,
  };
  assert.deepEqual(parseCalendarSettings(custom), custom);
});

test("toWorkingHours carries only the fields availability.ts needs", () => {
  const wh = toWorkingHours(DEFAULT_CALENDAR_SETTINGS);
  assert.deepEqual(wh, {
    timezone: DEFAULT_CALENDAR_SETTINGS.timezone,
    workingDays: DEFAULT_CALENDAR_SETTINGS.workingDays,
    startMinute: DEFAULT_CALENDAR_SETTINGS.startMinute,
    endMinute: DEFAULT_CALENDAR_SETTINGS.endMinute,
  });
});

test("validateCalendarSettingsInput accepts a well-formed submission", () => {
  const v = validateCalendarSettingsInput({
    timezone: "Asia/Riyadh",
    workingDays: [0, 1, 2, 3, 4],
    startMinute: 540,
    endMinute: 1020,
    slotMinutes: 30,
    lookaheadDays: 14,
    minNoticeMinutes: 120,
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test("validateCalendarSettingsInput rejects each bad field with its own code", () => {
  const v = validateCalendarSettingsInput({
    timezone: "Not/AZone",
    workingDays: [],
    startMinute: 1000,
    endMinute: 500, // before start
    slotMinutes: 1,
    lookaheadDays: 9999,
    minNoticeMinutes: -1,
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("calendar.validation.timezoneInvalid"));
  assert.ok(v.errors.includes("calendar.validation.workingDaysInvalid"));
  assert.ok(v.errors.includes("calendar.validation.endBeforeStart"));
  assert.ok(v.errors.includes("calendar.validation.slotMinutesInvalid"));
  assert.ok(v.errors.includes("calendar.validation.lookaheadInvalid"));
  assert.ok(v.errors.includes("calendar.validation.minNoticeInvalid"));
});
