import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Type-only: a runtime `import ... from "next/server"` fails to resolve under
// plain `node --test` (no bundler, no package "exports" map for that
// subpath). The route handler only ever calls `request.headers.get(...)`, so
// a real Fetch API `Request` — cast to the type below — is a faithful stand-in.
import type { NextRequest } from "next/server";
import { POST } from "./route.ts";

/**
 * The auth boundary (missing/wrong/correct secret) is fully testable without
 * a database: a missing/wrong secret returns before `runIntegrationHub` ever
 * runs, and `runIntegrationHub` itself fails safe to an empty summary when
 * Supabase isn't configured (see worker.ts) — so the "authorized" case is
 * exercisable here too, with no live DB required.
 */
const ORIGINAL_SECRET = process.env.INTEGRATION_HUB_CRON_SECRET;
const ORIGINAL_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function req(headers: Record<string, string> = {}): NextRequest {
  return new Request("http://localhost/api/internal/integrations/run", {
    method: "POST",
    headers,
  }) as unknown as NextRequest;
}

before(() => {
  // Force `createAdminClient()` to throw so the "authorized" test doesn't
  // need a real Supabase project — `runIntegrationHub` fails safe to an
  // empty summary in that case (see src/lib/integrations/worker.ts).
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.INTEGRATION_HUB_CRON_SECRET;
  else process.env.INTEGRATION_HUB_CRON_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SERVICE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_KEY;
});

test("no secret configured -> 503, never touches the worker", async () => {
  delete process.env.INTEGRATION_HUB_CRON_SECRET;
  const res = await POST(req());
  assert.equal(res.status, 503);
});

test("secret configured, wrong bearer -> 401", async () => {
  process.env.INTEGRATION_HUB_CRON_SECRET = "s".repeat(40);
  const res = await POST(req({ authorization: "Bearer wrong-secret-value" }));
  assert.equal(res.status, 401);
});

test("secret configured, missing header entirely -> 401", async () => {
  process.env.INTEGRATION_HUB_CRON_SECRET = "s".repeat(40);
  const res = await POST(req());
  assert.equal(res.status, 401);
});

test("secret configured, correct bearer -> 200 with a run summary", async () => {
  const secret = "s".repeat(40);
  process.env.INTEGRATION_HUB_CRON_SECRET = secret;
  const res = await POST(req({ authorization: `Bearer ${secret}` }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.runId, "string");
  assert.equal(typeof body.durationMs, "number");
});

test("secret configured, correct via x-cron-secret header -> 200", async () => {
  const secret = "s".repeat(40);
  process.env.INTEGRATION_HUB_CRON_SECRET = secret;
  const res = await POST(req({ "x-cron-secret": secret }));
  assert.equal(res.status, 200);
});
