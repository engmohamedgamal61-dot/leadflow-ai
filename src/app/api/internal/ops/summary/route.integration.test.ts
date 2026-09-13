import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import { GET } from "./route.ts";

/**
 * The one case `route.test.ts` can't prove without a real database: secret
 * configured + correct bearer + Supabase actually reachable -> `200` with a
 * real, safe aggregate summary body. Skipped unless `LEADFLOW_DB_TEST_URL` +
 * `LEADFLOW_DB_TEST_SERVICE_KEY` are set (a local `supabase start` instance —
 * never production).
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const enabled = Boolean(URL && KEY);
const skip = enabled ? false : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY";

const ORIGINAL_SECRET = process.env.OPS_STATUS_SECRET;
const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function req(headers: Record<string, string> = {}): NextRequest {
  return new Request("http://localhost/api/internal/ops/summary", { headers }) as unknown as NextRequest;
}

before(() => {
  if (!enabled) return;
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
});

after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.OPS_STATUS_SECRET;
  else process.env.OPS_STATUS_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
});

test("D. secret configured + correct bearer + real database -> 200 with a real, safe summary", { skip }, async () => {
  const secret = "s".repeat(40);
  process.env.OPS_STATUS_SECRET = secret;

  const res = await GET(req({ authorization: `Bearer ${secret}` }));
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(typeof body.followUps.pendingDue, "number");
  assert.equal(typeof body.integrationHub.pendingDeliveries, "number");
  assert.equal(typeof body.rateLimitCleanup.staleCount, "number");
  // Safe aggregate only — never a lead/org/webhook detail.
  assert.doesNotMatch(JSON.stringify(body), /lead|organization_id|webhook|payload/i);
});

test("D. the same request via x-cron-secret also reaches 200", { skip }, async () => {
  const secret = "s".repeat(40);
  process.env.OPS_STATUS_SECRET = secret;

  const res = await GET(req({ "x-cron-secret": secret }));
  assert.equal(res.status, 200);
});
