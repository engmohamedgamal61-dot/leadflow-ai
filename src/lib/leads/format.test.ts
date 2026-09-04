import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime } from "./format.ts";

test("formatDate / formatDateTime handle valid ISO and reject junk", () => {
  assert.match(formatDate("2026-09-04T10:30:00Z"), /Sep 4, 2026/);
  assert.match(formatDateTime("2026-09-04T10:30:00Z"), /Sep 4, 2026/);
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(undefined), "—");
  assert.equal(formatDate("not-a-date"), "—");
  assert.equal(formatDateTime(""), "—");
});
