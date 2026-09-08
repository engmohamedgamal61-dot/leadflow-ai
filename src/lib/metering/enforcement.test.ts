import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUsageAllowed } from "./enforcement.ts";
import { NO_LIMITS, type UsageLimits } from "./limits.ts";

const limits = (over: Partial<UsageLimits>): UsageLimits => ({ ...NO_LIMITS, ...over });

test("no organization id → allowed", async () => {
  const r = await checkUsageAllowed("", { limits: null, totals: null });
  assert.equal(r.allowed, true);
});

test("no limits row → allowed, no evaluation", async () => {
  const r = await checkUsageAllowed("org-1", { limits: null, totals: null });
  assert.equal(r.allowed, true);
  assert.equal(r.state, "ok");
  assert.equal(r.evaluation, null);
});

test("limits configured but hard limit OFF → always allowed (advisory)", async () => {
  const r = await checkUsageAllowed("org-1", {
    limits: limits({ monthlyTokenLimit: 1, hardLimitEnabled: false }),
    totals: { totalTokens: 999_999, totalRequests: 999, totalCostUsd: 999 },
  });
  assert.equal(r.allowed, true);
});

test("hard limit ON and a dimension exceeded → blocked", async () => {
  const r = await checkUsageAllowed("org-1", {
    limits: limits({ monthlyCostLimitUsd: 5, hardLimitEnabled: true }),
    totals: { totalTokens: 0, totalRequests: 0, totalCostUsd: 6 },
  });
  assert.equal(r.allowed, false);
  assert.equal(r.state, "block");
  assert.equal(r.evaluation?.allowNewRequests, false);
});

test("hard limit ON but under every limit → allowed", async () => {
  const r = await checkUsageAllowed("org-1", {
    limits: limits({
      monthlyTokenLimit: 1000,
      monthlyRequestLimit: 100,
      monthlyCostLimitUsd: 5,
      hardLimitEnabled: true,
    }),
    totals: { totalTokens: 10, totalRequests: 2, totalCostUsd: 0.1 },
  });
  assert.equal(r.allowed, true);
});

test("fails OPEN when the limits lookup throws", async () => {
  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: () => Promise.reject(new Error("db down")) };
            },
          };
        },
      };
    },
    rpc: () => Promise.reject(new Error("db down")),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const r = await checkUsageAllowed("org-1", { db });
  assert.equal(r.allowed, true);
});

test("fails OPEN when the usage aggregate RPC errors", async () => {
  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      monthly_token_limit: 1,
                      monthly_request_limit: null,
                      monthly_cost_limit_usd: null,
                      warning_threshold_percent: 80,
                      hard_limit_enabled: true,
                    },
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
    rpc: () => Promise.resolve({ data: null, error: { message: "no function" } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const r = await checkUsageAllowed("org-1", { db });
  assert.equal(r.allowed, true);
});

test("reads limits + totals from an injected db and blocks", async () => {
  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      monthly_token_limit: 100,
                      monthly_request_limit: null,
                      monthly_cost_limit_usd: null,
                      warning_threshold_percent: 80,
                      hard_limit_enabled: true,
                    },
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
    rpc: (name: string) => {
      assert.equal(name, "org_ai_usage_totals");
      return Promise.resolve({
        data: [
          {
            total_input_tokens: 100,
            total_output_tokens: 50,
            total_tokens: 150,
            total_requests: 3,
            total_cost_usd: 0.2,
          },
        ],
        error: null,
      });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const r = await checkUsageAllowed("org-1", { db });
  assert.equal(r.allowed, false); // 150 tokens > 100 limit, hard on
});
