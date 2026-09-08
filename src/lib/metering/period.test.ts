import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_TIME_ZONE,
  billingDateKey,
  currentMonthRange,
  dateKeysInRange,
  previousMonthRange,
  todayRange,
} from "./period.ts";

// Asia/Riyadh is UTC+3 with no DST — a clean fixed offset to assert against.

test("currentMonthRange spans the calendar month in the billing timezone", () => {
  // 2026-09-08 07:00Z is 10:00 in Riyadh, still September.
  const now = new Date("2026-09-08T07:00:00Z");
  const r = currentMonthRange(now);
  // Sept 1 00:00 Riyadh == Aug 31 21:00 UTC
  assert.equal(r.startIso, "2026-08-31T21:00:00.000Z");
  // Oct 1 00:00 Riyadh == Sept 30 21:00 UTC
  assert.equal(r.endIso, "2026-09-30T21:00:00.000Z");
});

test("previousMonthRange is the month immediately before", () => {
  const now = new Date("2026-09-08T07:00:00Z");
  const prev = previousMonthRange(now);
  const cur = currentMonthRange(now);
  assert.equal(prev.endIso, cur.startIso);
  assert.equal(prev.startIso, "2026-07-31T21:00:00.000Z");
});

test("month ranges roll across a year boundary", () => {
  const now = new Date("2026-01-15T12:00:00Z");
  const prev = previousMonthRange(now);
  assert.equal(prev.startIso, "2025-11-30T21:00:00.000Z");
  assert.equal(prev.endIso, "2025-12-31T21:00:00.000Z");
});

test("todayRange is a 24h window starting at local midnight", () => {
  // 2026-09-08 01:00 UTC == 04:00 Riyadh, so 'today' (Riyadh) is Sept 8.
  const now = new Date("2026-09-08T01:00:00Z");
  const r = todayRange(now);
  assert.equal(r.startIso, "2026-09-07T21:00:00.000Z"); // Sept 8 00:00 Riyadh
  assert.equal(r.endIso, "2026-09-08T21:00:00.000Z");
});

test("an instant just before local midnight belongs to the previous day", () => {
  // 2026-09-08 20:30 UTC == 23:30 Riyadh on Sept 8.
  const now = new Date("2026-09-08T20:30:00Z");
  const r = todayRange(now);
  assert.equal(r.startIso, "2026-09-07T21:00:00.000Z");
  // 45 minutes later it's Sept 9 in Riyadh.
  const later = todayRange(new Date("2026-09-08T21:30:00Z"));
  assert.equal(later.startIso, "2026-09-08T21:00:00.000Z");
});

test("billingDateKey uses the billing timezone's calendar date", () => {
  assert.equal(billingDateKey("2026-09-08T20:30:00Z"), "2026-09-08");
  assert.equal(billingDateKey("2026-09-08T21:30:00Z"), "2026-09-09");
});

test("dateKeysInRange enumerates every day of the month once, in order", () => {
  const now = new Date("2026-09-08T07:00:00Z");
  const keys = dateKeysInRange(currentMonthRange(now));
  assert.equal(keys.length, 30); // September
  assert.equal(keys[0], "2026-09-01");
  assert.equal(keys[29], "2026-09-30");
  assert.deepEqual(keys, [...keys].sort());
});

test("dateKeysInRange handles February", () => {
  const keys = dateKeysInRange(currentMonthRange(new Date("2026-02-10T12:00:00Z")));
  assert.equal(keys.length, 28);
  assert.equal(keys[27], "2026-02-28");
});

test("BILLING_TIME_ZONE is Asia/Riyadh", () => {
  assert.equal(BILLING_TIME_ZONE, "Asia/Riyadh");
});
