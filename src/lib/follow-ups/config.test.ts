import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveBatchSize,
  resolveMaxAttempts,
  resolveStuckAfterMs,
  retryDelayMs,
  nextAttemptAt,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  DEFAULT_MAX_ATTEMPTS,
} from "./config.ts";

test("resolveBatchSize is bounded and defaults sanely", () => {
  assert.equal(resolveBatchSize(undefined), DEFAULT_BATCH_SIZE);
  assert.equal(resolveBatchSize(""), DEFAULT_BATCH_SIZE);
  assert.equal(resolveBatchSize("0"), DEFAULT_BATCH_SIZE);
  assert.equal(resolveBatchSize("-5"), DEFAULT_BATCH_SIZE);
  assert.equal(resolveBatchSize("garbage"), DEFAULT_BATCH_SIZE);
  assert.equal(resolveBatchSize("10"), 10);
  assert.equal(resolveBatchSize(10), 10);
  assert.equal(resolveBatchSize("99999"), MAX_BATCH_SIZE);
});

test("resolveMaxAttempts is bounded [1,10]", () => {
  assert.equal(resolveMaxAttempts(undefined), DEFAULT_MAX_ATTEMPTS);
  assert.equal(resolveMaxAttempts("1"), 1);
  assert.equal(resolveMaxAttempts("50"), 10);
  assert.equal(resolveMaxAttempts("0"), DEFAULT_MAX_ATTEMPTS);
});

test("resolveStuckAfterMs never goes below 1 minute", () => {
  assert.equal(resolveStuckAfterMs("1000"), 15 * 60_000);
  assert.equal(resolveStuckAfterMs("120000"), 120_000);
  assert.equal(resolveStuckAfterMs("99999999"), 3_600_000);
});

test("retryDelayMs is deterministic and increasing", () => {
  assert.equal(retryDelayMs(1), 2 * 60_000);
  assert.equal(retryDelayMs(2), 10 * 60_000);
  assert.equal(retryDelayMs(3), 30 * 60_000);
  assert.equal(retryDelayMs(9), 30 * 60_000);
  assert.equal(retryDelayMs(0), 2 * 60_000);
});

test("nextAttemptAt returns a future ISO string", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  assert.equal(nextAttemptAt(1, now), "2026-09-04T12:02:00.000Z");
  assert.equal(nextAttemptAt(2, now), "2026-09-04T12:10:00.000Z");
});
