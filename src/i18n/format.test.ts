import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  relativeTimeBucket,
} from "./format.ts";

const ISO = "2026-09-04T10:30:00Z";
const ARABIC_INDIC = /[٠-٩۰-۹]/;

test("formatDate: English and Arabic both render the Gregorian year, Latin digits", () => {
  assert.match(formatDate(ISO, "en"), /Sep 4, 2026/);
  const ar = formatDate(ISO, "ar");
  assert.match(ar, /2026/); // Gregorian year, not Hijri (1448)
  assert.doesNotMatch(ar, ARABIC_INDIC);
});

test("formatDateTime rejects junk in both locales", () => {
  assert.equal(formatDateTime(null, "ar"), "—");
  assert.equal(formatDateTime("not-a-date", "en"), "—");
});

test("formatNumber groups with Latin digits in Arabic", () => {
  assert.equal(formatNumber(1234567, "en"), "1,234,567");
  const ar = formatNumber(1234567, "ar");
  assert.doesNotMatch(ar, ARABIC_INDIC);
  assert.match(ar, /1.234.567/);
  assert.equal(formatNumber(Number.NaN, "ar"), "—");
  assert.equal(formatNumber(undefined, "en"), "—");
});

test("formatPercent renders a whole-number percent, Latin digits", () => {
  assert.equal(formatPercent(0.25, "en"), "25%");
  const ar = formatPercent(0.5, "ar");
  assert.match(ar, /50/);
  assert.doesNotMatch(ar, ARABIC_INDIC);
  assert.equal(formatPercent(null, "ar"), "—");
});

test("default locale is English", () => {
  assert.equal(formatNumber(1000), "1,000");
});

test("relativeTimeBucket: buckets a past timestamp, falls back to a date past a week", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  assert.deepEqual(relativeTimeBucket(ago(30_000), now), { unit: "now" });
  assert.deepEqual(relativeTimeBucket(ago(5 * 60_000), now), { unit: "minutes", value: 5 });
  assert.deepEqual(relativeTimeBucket(ago(3 * 3_600_000), now), { unit: "hours", value: 3 });
  assert.deepEqual(relativeTimeBucket(ago(2 * 86_400_000), now), { unit: "days", value: 2 });
  assert.deepEqual(relativeTimeBucket(ago(30 * 86_400_000), now), { unit: "date" });
  assert.deepEqual(relativeTimeBucket(null, now), { unit: "date" });
  assert.deepEqual(relativeTimeBucket("not-a-date", now), { unit: "date" });
});
