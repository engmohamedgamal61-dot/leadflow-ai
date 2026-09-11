import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRateLimitRetentionSeconds } from "./rate-limit-cleanup.ts";

test("resolveRateLimitRetentionSeconds: sane 24h default when unset", () => {
  assert.equal(resolveRateLimitRetentionSeconds(undefined), 86_400);
});

test("resolveRateLimitRetentionSeconds: honors a larger override", () => {
  assert.equal(resolveRateLimitRetentionSeconds("172800"), 172_800);
});

test("resolveRateLimitRetentionSeconds: a valid but too-small override is floored at 3600s", () => {
  // Below the floor — clamped up, never allowed to shrink below every
  // current rate-limit rule's window (longest today: chat:org at 3600s).
  assert.equal(resolveRateLimitRetentionSeconds("60"), 3_600);
  assert.equal(resolveRateLimitRetentionSeconds("3599"), 3_600);
});

test("resolveRateLimitRetentionSeconds: an invalid override falls back to the (already-safe) default", () => {
  assert.equal(resolveRateLimitRetentionSeconds("0"), 86_400);
  assert.equal(resolveRateLimitRetentionSeconds("-100"), 86_400);
  assert.equal(resolveRateLimitRetentionSeconds("not-a-number"), 86_400);
});
