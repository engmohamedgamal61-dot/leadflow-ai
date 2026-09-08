import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateUsageLimits,
  NO_LIMITS,
  type UsageLimits,
} from "./limits.ts";

const limits = (over: Partial<UsageLimits> = {}): UsageLimits => ({
  ...NO_LIMITS,
  ...over,
});

test("no limits configured → always ok and always allowed", () => {
  const e = evaluateUsageLimits(
    { totalTokens: 999_999_999, totalRequests: 1_000_000, totalCostUsd: 5000 },
    NO_LIMITS,
  );
  assert.equal(e.state, "ok");
  assert.equal(e.allowNewRequests, true);
  assert.equal(e.anyLimitConfigured, false);
});

test("below the warning threshold → ok", () => {
  const e = evaluateUsageLimits(
    { totalTokens: 500, totalRequests: 0, totalCostUsd: 0 },
    limits({ monthlyTokenLimit: 1000, warningThresholdPercent: 80 }),
  );
  assert.equal(e.dimensions.tokens.state, "ok");
  assert.equal(e.state, "ok");
});

test("at/over the warning threshold → warn (advisory), still allowed", () => {
  const e = evaluateUsageLimits(
    { totalTokens: 850, totalRequests: 0, totalCostUsd: 0 },
    limits({ monthlyTokenLimit: 1000, warningThresholdPercent: 80 }),
  );
  assert.equal(e.dimensions.tokens.state, "warn");
  assert.equal(e.state, "warn");
  assert.equal(e.allowNewRequests, true);
  assert.deepEqual(e.triggered, ["tokens"]);
});

test("exceeded with hard limit OFF → warn, still allowed (soft limit)", () => {
  const e = evaluateUsageLimits(
    { totalTokens: 1200, totalRequests: 0, totalCostUsd: 0 },
    limits({ monthlyTokenLimit: 1000, hardLimitEnabled: false }),
  );
  assert.equal(e.dimensions.tokens.state, "exceeded");
  assert.equal(e.state, "warn");
  assert.equal(e.allowNewRequests, true);
});

test("exceeded with hard limit ON → block, not allowed", () => {
  const e = evaluateUsageLimits(
    { totalTokens: 1200, totalRequests: 0, totalCostUsd: 0 },
    limits({ monthlyTokenLimit: 1000, hardLimitEnabled: true }),
  );
  assert.equal(e.state, "block");
  assert.equal(e.allowNewRequests, false);
});

test("hard limit ON but nothing exceeded → allowed", () => {
  const e = evaluateUsageLimits(
    { totalTokens: 10, totalRequests: 1, totalCostUsd: 0.01 },
    limits({
      monthlyTokenLimit: 1000,
      monthlyRequestLimit: 100,
      monthlyCostLimitUsd: 5,
      hardLimitEnabled: true,
    }),
  );
  assert.equal(e.allowNewRequests, true);
  assert.equal(e.state, "ok");
});

test("each dimension is evaluated independently", () => {
  const e = evaluateUsageLimits(
    { totalTokens: 10, totalRequests: 95, totalCostUsd: 6 },
    limits({
      monthlyTokenLimit: 1000,
      monthlyRequestLimit: 100,
      monthlyCostLimitUsd: 5,
      warningThresholdPercent: 90,
      hardLimitEnabled: true,
    }),
  );
  assert.equal(e.dimensions.tokens.state, "ok");
  assert.equal(e.dimensions.requests.state, "warn"); // 95/100 ≥ 90%
  assert.equal(e.dimensions.cost.state, "exceeded"); // 6 > 5
  assert.equal(e.allowNewRequests, false); // cost exceeded + hard on
});

test("dimension detail carries ratio and remaining headroom", () => {
  const e = evaluateUsageLimits(
    { totalTokens: 250, totalRequests: 0, totalCostUsd: 0 },
    limits({ monthlyTokenLimit: 1000 }),
  );
  assert.equal(e.dimensions.tokens.ratio, 0.25);
  assert.equal(e.dimensions.tokens.remaining, 750);
  assert.equal(e.dimensions.requests.ratio, null);
  assert.equal(e.dimensions.requests.remaining, null);
});

test("threshold is clamped into 1..100", () => {
  const e = evaluateUsageLimits(
    { totalTokens: 10, totalRequests: 0, totalCostUsd: 0 },
    limits({ monthlyTokenLimit: 1000, warningThresholdPercent: 0 }),
  );
  // clamped to 1% → 10/1000 = 1% ≥ 1% → warn
  assert.equal(e.dimensions.tokens.state, "warn");
});
