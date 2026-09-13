import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getOpsBacklogSummary } from "./backlog.ts";

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

after(() => {
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
});

test("getOpsBacklogSummary: Supabase not configured -> not_configured, never throws", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const summary = await getOpsBacklogSummary();
  assert.deepEqual(summary, { status: "not_configured" });
});

test("getOpsBacklogSummary: a genuine query failure never throws, is reported per-section", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1"; // "bad port" — fails fast
  process.env.SUPABASE_SERVICE_ROLE_KEY = "s".repeat(40);
  const summary = await getOpsBacklogSummary();
  assert.equal(summary.status, "error");
  assert.ok(Array.isArray(summary.errors));
  assert.deepEqual(
    [...summary.errors!].sort(),
    ["follow_ups_query_failed", "integration_hub_query_failed", "rate_limit_query_failed"],
  );
  // No partial/garbage section data alongside the error for that section.
  assert.equal(summary.followUps, undefined);
  assert.equal(summary.integrationHub, undefined);
  assert.equal(summary.rateLimitCleanup, undefined);
});
