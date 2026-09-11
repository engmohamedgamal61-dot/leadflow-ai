import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

/**
 * Real-Postgres tests for `cleanup_expired_rate_limits`. Skipped without a
 * local Supabase — same env-gate as `pilot-hardening.integration.test.ts`,
 * which already covers `hit_rate_limit` itself.
 *
 * `private.rate_limits` isn't PostgREST-reachable (by design — see the
 * `security_hardening` migration), so these tests only go through the two
 * RPCs actually exposed to `service_role`: `hit_rate_limit` (to create rows)
 * and `cleanup_expired_rate_limits` (the function under test). The RPC is
 * called directly with a short window here to prove real deletion happens —
 * the production caller (`src/lib/security/rate-limit-cleanup.ts`) always
 * floors the retention at 1h; that floor is a JS-layer test
 * (`rate-limit-cleanup.test.ts`), not exercised here.
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const enabled = Boolean(URL && SERVICE_KEY && ANON_KEY && ANON_KEY !== SERVICE_KEY);
const skip = enabled ? false : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY + LEADFLOW_DB_TEST_ANON_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
const stamp = Date.now();
let admin: AnyClient;

before(() => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
});

test("cleanup_expired_rate_limits deletes a row once it is older than the given age", { skip }, async () => {
  const key = `rl-cleanup-it-${stamp}:old`;
  const hit = await admin.rpc("hit_rate_limit", { p_key: key, p_max: 100, p_window_seconds: 3600 });
  assert.equal(hit.error, null);

  // A 0-second "older than" threshold still requires window_start to be
  // strictly in the past — wait past the wall-clock tick so `now()` at
  // cleanup time is provably later than the row's `window_start`.
  await new Promise((r) => setTimeout(r, 1100));

  const cleaned = await admin.rpc("cleanup_expired_rate_limits", { p_older_than_seconds: 0 });
  assert.equal(cleaned.error, null);
  assert.ok(cleaned.data >= 1, "expected at least the row we just created to be deleted");

  // The key is gone: the next hit starts a fresh window at count 1, not a
  // continuation of the old (already-at-100) counter.
  const rehit = await admin.rpc("hit_rate_limit", { p_key: key, p_max: 1, p_window_seconds: 3600 });
  assert.equal(rehit.error, null);
  assert.equal(rehit.data, true, "a fresh window (count 1) should be under max 1");
});

test("cleanup_expired_rate_limits leaves a row untouched when the retention window hasn't elapsed", { skip }, async () => {
  const key = `rl-cleanup-it-${stamp}:active`;
  // Establish a real counter above 1 so a reset would be observable.
  await admin.rpc("hit_rate_limit", { p_key: key, p_max: 100, p_window_seconds: 3600 });
  await admin.rpc("hit_rate_limit", { p_key: key, p_max: 100, p_window_seconds: 3600 });
  const third = await admin.rpc("hit_rate_limit", { p_key: key, p_max: 100, p_window_seconds: 3600 });
  assert.equal(third.error, null);
  assert.equal(third.data, true);

  // A large "older than" threshold: the row is only seconds old, nowhere
  // near stale — cleanup must not touch it.
  const cleaned = await admin.rpc("cleanup_expired_rate_limits", { p_older_than_seconds: 3600 });
  assert.equal(cleaned.error, null);

  // The counter continues from where it left off (4th hit), proving the row
  // — and its window/count — survived the cleanup call untouched.
  const fourth = await admin.rpc("hit_rate_limit", { p_key: key, p_max: 3, p_window_seconds: 3600 });
  assert.equal(fourth.error, null);
  assert.equal(fourth.data, false, "count should already be 4, over max 3 — proves the row wasn't reset/deleted");
});

test("cleanup_expired_rate_limits is not callable by an anon or authenticated client", { skip }, async () => {
  const anon = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonCall = await anon.rpc("cleanup_expired_rate_limits", { p_older_than_seconds: 3600 });
  assert.ok(anonCall.error, "anon must be denied");
});
