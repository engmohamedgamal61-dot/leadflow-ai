import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  parseStoredConfig,
  effectiveConfigFromStored,
} from "./organization-config.ts";
import { buildSystemPrompt } from "../chat/system-prompt.ts";

/**
 * Real-Postgres tests for organization config: RLS isolation + owner/admin-only
 * writes (mirrors the `organization_configs` policies), and that a stored blob
 * read back through the merge reaches the system prompt. Skipped unless
 * `LEADFLOW_DB_TEST_URL` + `_SERVICE_KEY` + a DISTINCT `_ANON_KEY`.
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const enabled = Boolean(URL && SERVICE_KEY && ANON_KEY && ANON_KEY !== SERVICE_KEY);
const skip = enabled
  ? false
  : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY + LEADFLOW_DB_TEST_ANON_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
const stamp = Date.now();
let admin: AnyClient;
const users: Record<string, { id: string; client: AnyClient }> = {};
let orgA = "";
let orgB = "";

async function makeUser(tag: string) {
  const email = `cfg-it-${tag}-${stamp}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: "test-password-123",
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const client = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await client.auth.signInWithPassword({
    email,
    password: "test-password-123",
  });
  if (signIn.error) throw signIn.error;
  users[tag] = { id: created.data.user.id, client };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await makeUser("a"); // owner A
  await makeUser("b"); // owner B
  await makeUser("m"); // manager in A
  await makeUser("v"); // viewer in A

  orgA = (
    await users.a.client.rpc("create_organization_with_owner", {
      p_name: "Cfg IT Org A",
      p_industry_template_id: "real-estate",
    })
  ).data.id;
  orgB = (
    await users.b.client.rpc("create_organization_with_owner", {
      p_name: "Cfg IT Org B",
      p_industry_template_id: "clinic",
    })
  ).data.id;

  await users.a.client
    .from("organization_members")
    .insert({ organization_id: orgA, user_id: users.m.id, role: "manager" });
  await users.a.client
    .from("organization_members")
    .insert({ organization_id: orgA, user_id: users.v.id, role: "viewer" });
});

after(async () => {
  if (!enabled) return;
  for (const org of [orgA, orgB]) if (org) await admin.from("organizations").delete().eq("id", org);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

test("owner can write config; it reads back and reaches the system prompt", { skip }, async () => {
  const blob = {
    aiBehaviorOverrides: {
      tone: "brisk and formal, no emoji",
      additionalRules: ["Never mention competitors."],
    },
    scoringOverrides: { thresholds: { hot: 70, warm: 35 } },
  };
  const write = await users.a.client
    .from("organization_configs")
    .upsert({ organization_id: orgA, config: blob }, { onConflict: "organization_id" })
    .select("organization_id");
  assert.equal(write.error, null);
  assert.equal(write.data.length, 1);

  const read = await users.a.client
    .from("organization_configs")
    .select("config")
    .eq("organization_id", orgA)
    .maybeSingle();
  assert.equal(read.error, null);

  const stored = parseStoredConfig(read.data.config);
  const eff = effectiveConfigFromStored(orgA, "real-estate", stored);
  assert.equal(eff.aiBehavior.tone, "brisk and formal, no emoji");
  assert.equal(eff.scoring.thresholds.hot, 70);

  const prompt = buildSystemPrompt(eff);
  assert.match(prompt, /Never mention competitors\./);
  assert.match(prompt, /Brisk and formal/);
});

test("organization A cannot read organization B's config", { skip }, async () => {
  await users.b.client
    .from("organization_configs")
    .upsert({ organization_id: orgB, config: { aiBehaviorOverrides: { tone: "secret" } } }, { onConflict: "organization_id" });

  const probe = await users.a.client
    .from("organization_configs")
    .select("config")
    .eq("organization_id", orgB);
  assert.deepEqual(probe.data, []);
});

test("organization A cannot write organization B's config", { skip }, async () => {
  const attempt = await users.a.client
    .from("organization_configs")
    .update({ config: { aiBehaviorOverrides: { tone: "hijacked" } } })
    .eq("organization_id", orgB)
    .select("organization_id");
  assert.ok(attempt.error || (attempt.data ?? []).length === 0);

  const check = await admin
    .from("organization_configs")
    .select("config")
    .eq("organization_id", orgB)
    .single();
  assert.notEqual((check.data.config as { aiBehaviorOverrides?: { tone?: string } })?.aiBehaviorOverrides?.tone, "hijacked");
});

test("manager and viewer cannot write config (owner/admin only)", { skip }, async () => {
  for (const tag of ["m", "v"]) {
    const upd = await users[tag].client
      .from("organization_configs")
      .update({ config: { aiBehaviorOverrides: { tone: `by-${tag}` } } })
      .eq("organization_id", orgA)
      .select("organization_id");
    assert.ok(upd.error || (upd.data ?? []).length === 0, `${tag} must not write config`);

    // they CAN still read it
    const read = await users[tag].client
      .from("organization_configs")
      .select("config")
      .eq("organization_id", orgA);
    assert.equal(read.error, null);
    assert.equal(read.data.length, 1);
  }
  const after = await admin
    .from("organization_configs")
    .select("config")
    .eq("organization_id", orgA)
    .single();
  assert.equal(
    (after.data.config as { aiBehaviorOverrides?: { tone?: string } }).aiBehaviorOverrides?.tone,
    "brisk and formal, no emoji", // unchanged from the owner's write
  );
});
