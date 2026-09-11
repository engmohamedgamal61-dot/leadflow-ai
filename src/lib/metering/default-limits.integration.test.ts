import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  ensureDefaultUsageLimits,
  DEFAULT_MONTHLY_TOKEN_LIMIT,
  DEFAULT_MONTHLY_REQUEST_LIMIT,
  DEFAULT_MONTHLY_COST_LIMIT_USD,
  DEFAULT_USAGE_HARD_LIMIT_ENABLED,
} from "./default-limits.ts";

/**
 * Real-Postgres tests proving: a new organization receives the default usage
 * cap, and an existing (owner-configured, or previously-defaulted) limit is
 * never overwritten. Same env-gate / org-seeding pattern as
 * `metering.integration.test.ts`.
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const enabled = Boolean(URL && SERVICE_KEY && ANON_KEY && ANON_KEY !== SERVICE_KEY);
const skip = enabled ? false : "set LEADFLOW_DB_TEST_URL / _SERVICE_KEY / _ANON_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
const stamp = Date.now();
let admin: AnyClient;
const users: Record<string, { id: string; client: AnyClient }> = {};
let orgNew = "";
let orgCustom = "";

async function makeUser(tag: string) {
  const email = `default-limits-it-${tag}-${stamp}@example.test`;
  const c = await admin.auth.admin.createUser({
    email,
    password: "test-password-123",
    email_confirm: true,
  });
  if (c.error) throw c.error;
  const client = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const s = await client.auth.signInWithPassword({ email, password: "test-password-123" });
  if (s.error) throw s.error;
  users[tag] = { id: c.data.user.id, client };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await makeUser("new");
  await makeUser("custom");
  orgNew = (
    await users.new.client.rpc("create_organization_with_owner", {
      p_name: "Default Limits IT New",
      p_industry_template_id: "real-estate",
    })
  ).data.id;
  orgCustom = (
    await users.custom.client.rpc("create_organization_with_owner", {
      p_name: "Default Limits IT Custom",
      p_industry_template_id: "real-estate",
    })
  ).data.id;
});

after(async () => {
  if (!enabled) return;
  for (const o of [orgNew, orgCustom]) if (o) await admin.from("organizations").delete().eq("id", o);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

test("a newly created organization receives the default usage cap", { skip }, async () => {
  await ensureDefaultUsageLimits(users.new.client, orgNew);

  const { data, error } = await users.new.client
    .from("organization_usage_limits")
    .select("*")
    .eq("organization_id", orgNew)
    .single();
  assert.equal(error, null);
  assert.equal(data.monthly_token_limit, DEFAULT_MONTHLY_TOKEN_LIMIT);
  assert.equal(data.monthly_request_limit, DEFAULT_MONTHLY_REQUEST_LIMIT);
  assert.equal(Number(data.monthly_cost_limit_usd), DEFAULT_MONTHLY_COST_LIMIT_USD);
  assert.equal(data.hard_limit_enabled, DEFAULT_USAGE_HARD_LIMIT_ENABLED);
});

test("calling ensureDefaultUsageLimits again on the same org is a harmless no-op", { skip }, async () => {
  // Already defaulted by the previous test — a retried onboarding call (or a
  // duplicate invocation) must not error and must not touch the row.
  await ensureDefaultUsageLimits(users.new.client, orgNew);

  const { data, error } = await users.new.client
    .from("organization_usage_limits")
    .select("monthly_token_limit")
    .eq("organization_id", orgNew)
    .single();
  assert.equal(error, null);
  assert.equal(data.monthly_token_limit, DEFAULT_MONTHLY_TOKEN_LIMIT);
});

test("an organization's existing explicit limit is never overwritten by the default", { skip }, async () => {
  // The owner configures a custom limit BEFORE the default would ever run
  // (simulating an org that customized immediately, or a race).
  const custom = await users.custom.client
    .from("organization_usage_limits")
    .upsert(
      {
        organization_id: orgCustom,
        monthly_token_limit: 999,
        monthly_request_limit: 42,
        monthly_cost_limit_usd: 5,
        hard_limit_enabled: true,
      },
      { onConflict: "organization_id" },
    )
    .select("organization_id");
  assert.equal(custom.error, null);

  await ensureDefaultUsageLimits(users.custom.client, orgCustom);

  const { data, error } = await users.custom.client
    .from("organization_usage_limits")
    .select("*")
    .eq("organization_id", orgCustom)
    .single();
  assert.equal(error, null);
  assert.equal(data.monthly_token_limit, 999, "custom limit must survive ensureDefaultUsageLimits");
  assert.equal(data.monthly_request_limit, 42);
  assert.equal(Number(data.monthly_cost_limit_usd), 5);
});
