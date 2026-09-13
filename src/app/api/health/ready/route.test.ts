import { test, after } from "node:test";
import assert from "node:assert/strict";
import { GET } from "./route.ts";

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

after(() => {
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
});

test("readiness: database unreachable/not configured -> 503, safe body only", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await GET();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, "degraded");
  assert.equal(body.checks.database.status, "down");
  assert.equal(body.checks.database.error, "not_configured");
  assert.equal(typeof body.checks.database.latencyMs, "number");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("readiness: response never contains a raw error message, stack, or secret-shaped value", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await GET();
  const raw = JSON.stringify(await res.json());
  assert.doesNotMatch(raw, /postgres|password|service_role|Bearer|stack/i);
});
