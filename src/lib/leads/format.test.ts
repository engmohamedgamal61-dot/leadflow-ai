import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime } from "./format.ts";

test("formatDate / formatDateTime handle valid ISO and reject junk (default locale)", () => {
  assert.match(formatDate("2026-09-04T10:30:00Z"), /Sep 4, 2026/);
  assert.match(formatDateTime("2026-09-04T10:30:00Z"), /Sep 4, 2026/);
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(undefined), "—");
  assert.equal(formatDate("not-a-date"), "—");
  assert.equal(formatDateTime(""), "—");
});

test("formatDate is locale-aware but always Gregorian + Latin digits", () => {
  const ar = formatDate("2026-09-04T10:30:00Z", "ar");
  assert.match(ar, /2026/); // Latin digits, Gregorian year — not ١٤٤٨ Hijri
  assert.doesNotMatch(ar, /[٠-٩]/); // no Arabic-Indic digits
});
