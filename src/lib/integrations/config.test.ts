import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_ATTEMPTS,
  resolveDeliveryBatchSize,
  resolveMaxAttempts,
  resolveHttpTimeoutMs,
  retryDelayMs,
  nextAttemptAt,
} from "./config.ts";

test("retry backoff is monotonic non-decreasing and caps at 6h", () => {
  const delays = [1, 2, 3, 4, 5, 6, 7, 20].map(retryDelayMs);
  for (let i = 1; i < delays.length; i += 1) {
    assert.ok(delays[i] >= delays[i - 1], `not monotonic at ${i}`);
  }
  assert.equal(retryDelayMs(1), 30_000);
  assert.equal(retryDelayMs(6), 21_600_000);
  assert.equal(retryDelayMs(99), 21_600_000);
});

test("nextAttemptAt returns a future ISO string offset by the backoff", () => {
  const now = new Date("2026-09-07T00:00:00.000Z");
  assert.equal(nextAttemptAt(1, now), "2026-09-07T00:00:30.000Z");
  assert.equal(nextAttemptAt(2, now), "2026-09-07T00:02:00.000Z");
});

test("resolveMaxAttempts is bounded [1,12] with a sane default", () => {
  assert.equal(resolveMaxAttempts(undefined), DEFAULT_MAX_ATTEMPTS);
  assert.equal(resolveMaxAttempts("0"), DEFAULT_MAX_ATTEMPTS);
  assert.equal(resolveMaxAttempts("3"), 3);
  assert.equal(resolveMaxAttempts("999"), 12);
});

test("resolveDeliveryBatchSize is bounded [1,200]", () => {
  assert.equal(resolveDeliveryBatchSize("50"), 50);
  assert.equal(resolveDeliveryBatchSize("0"), 20);
  assert.equal(resolveDeliveryBatchSize("5000"), 200);
});

test("resolveHttpTimeoutMs floors at 1s and caps at 30s", () => {
  assert.equal(resolveHttpTimeoutMs("500"), 10_000);
  assert.equal(resolveHttpTimeoutMs("5000"), 5_000);
  assert.equal(resolveHttpTimeoutMs("120000"), 30_000);
});
