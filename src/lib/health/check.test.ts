import { test, after } from "node:test";
import assert from "node:assert/strict";
import { checkDatabaseConnectivity } from "./check.ts";

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

after(() => {
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
});

test("checkDatabaseConnectivity: not configured -> ok:false, never throws", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const result = await checkDatabaseConnectivity();
  assert.deepEqual(result, { ok: false, latencyMs: 0, error: "not_configured" });
});

test("checkDatabaseConnectivity: unreachable host -> ok:false within the given timeout, never throws", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1"; // "bad port" — fails fast
  process.env.SUPABASE_SERVICE_ROLE_KEY = "s".repeat(40);
  const started = Date.now();
  const result = await checkDatabaseConnectivity(1500);
  assert.equal(result.ok, false);
  assert.ok(result.error, "a safe error classification is always present on failure");
  assert.ok(
    Date.now() - started < 5000,
    "bounded by the given timeout, not left to hang indefinitely",
  );
});

test("checkDatabaseConnectivity: never returns a raw error message, only a safe classification", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "s".repeat(40);
  const result = await checkDatabaseConnectivity(1500);
  if (result.error) {
    assert.ok(
      ["not_configured", "timeout", "query_failed"].includes(result.error),
      `unexpected error shape leaked: ${result.error}`,
    );
  }
});
