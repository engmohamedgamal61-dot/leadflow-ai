import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { checkDatabaseConnectivity } from "./check.ts";

/**
 * The one thing the unit tests (env unset / unreachable host) can't cover:
 * a REAL, reachable database actually answering `ok: true`. Skipped unless
 * `LEADFLOW_DB_TEST_URL` + `LEADFLOW_DB_TEST_SERVICE_KEY` are set (a local
 * `supabase start` instance — never production).
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const enabled = Boolean(URL && KEY);
const skip = enabled ? false : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY";

const ADMIN_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

before(() => {
  if (!enabled) return;
  for (const k of ADMIN_ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
});

after(() => {
  if (!enabled) return;
  for (const k of ADMIN_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test("checkDatabaseConnectivity: a real, reachable database reports ok:true with a real latency", { skip }, async () => {
  const result = await checkDatabaseConnectivity();
  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
  assert.equal(typeof result.latencyMs, "number");
  assert.ok(result.latencyMs >= 0);
});
