import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MONTHLY_TOKEN_LIMIT,
  DEFAULT_MONTHLY_REQUEST_LIMIT,
  DEFAULT_MONTHLY_COST_LIMIT_USD,
  DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT,
  DEFAULT_USAGE_HARD_LIMIT_ENABLED,
  buildDefaultUsageLimitsRow,
} from "./default-limits.ts";
import { checkUsageAllowed } from "./enforcement.ts";
import type { UsageLimits } from "./limits.ts";

test("defaults are generous but finite (never unlimited) and hard-enforced", () => {
  assert.ok(DEFAULT_MONTHLY_TOKEN_LIMIT > 0);
  assert.ok(DEFAULT_MONTHLY_REQUEST_LIMIT > 0);
  assert.ok(DEFAULT_MONTHLY_COST_LIMIT_USD > 0);
  assert.ok(
    DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT >= 1 &&
      DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT <= 100,
  );
  // Enforcement, not just an advisory dashboard number — "must not be
  // unlimited by default" means the cap actually blocks.
  assert.equal(DEFAULT_USAGE_HARD_LIMIT_ENABLED, true);
});

test("buildDefaultUsageLimitsRow shapes a valid organization_usage_limits insert", () => {
  const row = buildDefaultUsageLimitsRow("org-123");
  assert.equal(row.organization_id, "org-123");
  assert.equal(row.monthly_token_limit, DEFAULT_MONTHLY_TOKEN_LIMIT);
  assert.equal(row.monthly_request_limit, DEFAULT_MONTHLY_REQUEST_LIMIT);
  assert.equal(row.monthly_cost_limit_usd, DEFAULT_MONTHLY_COST_LIMIT_USD);
  assert.equal(row.warning_threshold_percent, DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT);
  assert.equal(row.hard_limit_enabled, DEFAULT_USAGE_HARD_LIMIT_ENABLED);
});

test("buildDefaultUsageLimitsRow is deterministic for the same org id", () => {
  const a = buildDefaultUsageLimitsRow("org-abc");
  const b = buildDefaultUsageLimitsRow("org-abc");
  assert.deepEqual(a, b);
});

/** The default row's values, in `UsageLimits` (camelCase) shape — what
 * `checkUsageAllowed` actually consumes. Exercises the DEFAULT values through
 * the real (unmodified) enforcement gate via its dependency-injection seam —
 * no DB required. */
const defaultAsUsageLimits: UsageLimits = {
  monthlyTokenLimit: DEFAULT_MONTHLY_TOKEN_LIMIT,
  monthlyRequestLimit: DEFAULT_MONTHLY_REQUEST_LIMIT,
  monthlyCostLimitUsd: DEFAULT_MONTHLY_COST_LIMIT_USD,
  warningThresholdPercent: DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT,
  hardLimitEnabled: DEFAULT_USAGE_HARD_LIMIT_ENABLED,
};

test("default usage cap enforcement: a new org under its default limits is allowed", async () => {
  const gate = await checkUsageAllowed("org-under", {
    limits: defaultAsUsageLimits,
    totals: { totalTokens: 100, totalRequests: 1, totalCostUsd: 0.01 },
  });
  assert.equal(gate.allowed, true);
});

test("default usage cap enforcement: exceeding the default request limit blocks new calls", async () => {
  const gate = await checkUsageAllowed("org-over", {
    limits: defaultAsUsageLimits,
    totals: {
      totalTokens: 0,
      totalRequests: DEFAULT_MONTHLY_REQUEST_LIMIT + 1,
      totalCostUsd: 0,
    },
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.state, "block");
});

test("default usage cap enforcement: exceeding the default cost limit blocks new calls", async () => {
  const gate = await checkUsageAllowed("org-over-cost", {
    limits: defaultAsUsageLimits,
    totals: {
      totalTokens: 0,
      totalRequests: 0,
      totalCostUsd: DEFAULT_MONTHLY_COST_LIMIT_USD + 1,
    },
  });
  assert.equal(gate.allowed, false);
});
