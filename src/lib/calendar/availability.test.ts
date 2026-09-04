import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAvailableSlots, isSlotFree } from "./availability.ts";
import { DEFAULT_CALENDAR_SETTINGS, toWorkingHours } from "./config.ts";

// 2026-09-04 is a Friday; Asia/Riyadh has no DST (fixed UTC+3).
const FRIDAY_NOON_UTC = new Date("2026-09-04T12:00:00Z");
const WORKING_HOURS = toWorkingHours(DEFAULT_CALENDAR_SETTINGS); // Sun–Thu 09:00–17:00 Asia/Riyadh

test("skips non-working days and starts on the next working day, 09:00 local", () => {
  const slots = computeAvailableSlots({
    workingHours: WORKING_HOURS,
    busy: [],
    lookaheadDays: 7,
    slotMinutes: 60,
    minNoticeMs: 0,
    now: FRIDAY_NOON_UTC,
  });
  // Fri/Sat are non-working; the first slot is Sunday 09:00 Riyadh = 06:00 UTC.
  assert.equal(slots[0].startsAt, "2026-09-06T06:00:00.000Z");
  assert.equal(slots[0].endsAt, "2026-09-06T07:00:00.000Z");
});

test("generates every slot within working hours at the given granularity", () => {
  const slots = computeAvailableSlots({
    workingHours: WORKING_HOURS,
    busy: [],
    lookaheadDays: 2,
    slotMinutes: 30,
    minNoticeMs: 0,
    now: new Date("2026-09-06T00:00:00Z"), // Sunday, before working hours
  });
  const sunday = slots.filter((s) => s.startsAt.startsWith("2026-09-06"));
  // 09:00–17:00 in 30-minute slots = 16 slots.
  assert.equal(sunday.length, 16);
  assert.equal(sunday[0].startsAt, "2026-09-06T06:00:00.000Z"); // 09:00 Riyadh
  assert.equal(sunday.at(-1)!.startsAt, "2026-09-06T13:30:00.000Z"); // 16:30 Riyadh
});

test("a busy interval removes exactly the overlapping slot(s)", () => {
  const slots = computeAvailableSlots({
    workingHours: WORKING_HOURS,
    busy: [{ startsAt: "2026-09-06T07:00:00Z", endsAt: "2026-09-06T08:00:00Z" }], // 10:00–11:00 Riyadh
    lookaheadDays: 1,
    slotMinutes: 60,
    minNoticeMs: 0,
    now: new Date("2026-09-06T00:00:00Z"),
  });
  const times = slots.map((s) => s.startsAt);
  assert.ok(!times.includes("2026-09-06T07:00:00.000Z"));
  assert.ok(times.includes("2026-09-06T06:00:00.000Z"));
  assert.ok(times.includes("2026-09-06T08:00:00.000Z"));
});

test("minimum notice excludes slots that start too soon", () => {
  const now = new Date("2026-09-06T06:00:00Z"); // 09:00 Riyadh, the first slot itself
  const withoutNotice = computeAvailableSlots({
    workingHours: WORKING_HOURS,
    busy: [],
    lookaheadDays: 1,
    slotMinutes: 60,
    minNoticeMs: 0,
    now,
  });
  assert.ok(withoutNotice.some((s) => s.startsAt === "2026-09-06T06:00:00.000Z"));

  const twoHourNotice = computeAvailableSlots({
    workingHours: WORKING_HOURS,
    busy: [],
    lookaheadDays: 1,
    slotMinutes: 60,
    minNoticeMs: 2 * 60 * 60_000,
    now,
  });
  assert.ok(!twoHourNotice.some((s) => s.startsAt === "2026-09-06T06:00:00.000Z"));
  assert.ok(twoHourNotice.some((s) => s.startsAt === "2026-09-06T08:00:00.000Z"));
});

test("degenerate input (zero/negative slot size or lookahead) yields no slots", () => {
  const base = {
    workingHours: WORKING_HOURS,
    busy: [],
    minNoticeMs: 0,
    now: FRIDAY_NOON_UTC,
  };
  assert.deepEqual(computeAvailableSlots({ ...base, lookaheadDays: 7, slotMinutes: 0 }), []);
  assert.deepEqual(computeAvailableSlots({ ...base, lookaheadDays: 0, slotMinutes: 30 }), []);
});

test("maxSlots caps the returned list", () => {
  const slots = computeAvailableSlots({
    workingHours: WORKING_HOURS,
    busy: [],
    lookaheadDays: 30,
    slotMinutes: 30,
    minNoticeMs: 0,
    now: FRIDAY_NOON_UTC,
    maxSlots: 5,
  });
  assert.equal(slots.length, 5);
});

test("isSlotFree: true with no overlap, false when a busy interval overlaps", () => {
  const slot = { startsAt: "2026-09-06T06:00:00.000Z", endsAt: "2026-09-06T07:00:00.000Z" };
  assert.equal(isSlotFree(slot, []), true);
  assert.equal(
    isSlotFree(slot, [{ startsAt: "2026-09-06T06:30:00Z", endsAt: "2026-09-06T06:45:00Z" }]),
    false,
  );
  // adjacent, non-overlapping ([start, end) semantics)
  assert.equal(
    isSlotFree(slot, [{ startsAt: "2026-09-06T07:00:00Z", endsAt: "2026-09-06T08:00:00Z" }]),
    true,
  );
});

test("a custom working-day set (e.g. Mon–Fri) is honoured", () => {
  const mondayToFriday = {
    timezone: "UTC",
    workingDays: [1, 2, 3, 4, 5],
    startMinute: 9 * 60,
    endMinute: 17 * 60,
  };
  const slots = computeAvailableSlots({
    workingHours: mondayToFriday,
    busy: [],
    lookaheadDays: 3,
    slotMinutes: 60,
    minNoticeMs: 0,
    now: FRIDAY_NOON_UTC, // Friday afternoon
  });
  // Friday's working hours (09-17) already passed at noon+ for some slots but
  // the afternoon ones remain; Saturday/Sunday must be entirely absent.
  assert.ok(!slots.some((s) => s.startsAt.startsWith("2026-09-05")));
  assert.ok(!slots.some((s) => s.startsAt.startsWith("2026-09-06")));
  assert.ok(slots.some((s) => s.startsAt.startsWith("2026-09-07"))); // Monday
});
