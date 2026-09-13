import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import { GET } from "./route.ts";

const ORIGINAL_SECRET = process.env.OPS_STATUS_SECRET;
const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function req(headers: Record<string, string> = {}): NextRequest {
  return new Request("http://localhost/api/internal/ops/summary", { headers }) as unknown as NextRequest;
}

before(() => {
  // No real Supabase needed for the auth-boundary tests — `getOpsBacklogSummary`
  // fails safe to `not_configured` (see backlog.ts / backlog.test.ts).
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.OPS_STATUS_SECRET;
  else process.env.OPS_STATUS_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
});

test("no secret configured -> 503, never queries the database", async () => {
  delete process.env.OPS_STATUS_SECRET;
  const res = await GET(req());
  assert.equal(res.status, 503);
});

test("secret configured, wrong bearer -> 401", async () => {
  process.env.OPS_STATUS_SECRET = "s".repeat(40);
  const res = await GET(req({ authorization: "Bearer wrong-secret-value" }));
  assert.equal(res.status, 401);
});

test("secret configured, missing header -> 401", async () => {
  process.env.OPS_STATUS_SECRET = "s".repeat(40);
  const res = await GET(req());
  assert.equal(res.status, 401);
});

test("secret configured, correct bearer, Supabase not configured -> 503 with not_configured", async () => {
  const secret = "s".repeat(40);
  process.env.OPS_STATUS_SECRET = secret;
  const res = await GET(req({ authorization: `Bearer ${secret}` }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, "not_configured");
});

test("secret configured, correct via x-cron-secret header -> reaches the summary (still not_configured here)", async () => {
  const secret = "s".repeat(40);
  process.env.OPS_STATUS_SECRET = secret;
  const res = await GET(req({ "x-cron-secret": secret }));
  assert.equal(res.status, 503);
});
