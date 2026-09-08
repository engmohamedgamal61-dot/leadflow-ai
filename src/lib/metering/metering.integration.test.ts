import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { recordAiUsage } from "./service.ts";
import { estimateCostUsd } from "./pricing.ts";
import { checkUsageAllowed } from "./enforcement.ts";
import { currentMonthRange } from "./period.ts";

/**
 * Real-Postgres tests for Phase O usage metering. Skipped without local
 * Supabase. Covers: usage recording, per-org RLS isolation, viewer access
 * restriction, idempotent concurrent recording, the enforcement aggregate RPC,
 * cost calculation, and owner-only limits configuration.
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const enabled = Boolean(
  URL && SERVICE_KEY && ANON_KEY && ANON_KEY !== SERVICE_KEY,
);
const skip = enabled ? false : "set LEADFLOW_DB_TEST_URL / _SERVICE_KEY / _ANON_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
const stamp = Date.now();
let admin: AnyClient;
const users: Record<string, { id: string; client: AnyClient }> = {};
let orgA = "";
let orgB = "";
let leadA = "";

async function makeUser(tag: string) {
  const email = `metering-it-${tag}-${stamp}@example.test`;
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

function usage(requestType: string, over: Record<string, unknown> = {}) {
  return {
    organizationId: orgA,
    requestType: requestType as "chat_reply" | "lead_extraction",
    model: "claude-sonnet-5",
    channel: "web",
    usage: { inputTokens: 1000, outputTokens: 200 },
    ...over,
  };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await makeUser("a");
  await makeUser("b");
  await makeUser("v");
  orgA = (
    await users.a.client.rpc("create_organization_with_owner", {
      p_name: "Metering IT A",
      p_industry_template_id: "real-estate",
    })
  ).data.id;
  orgB = (
    await users.b.client.rpc("create_organization_with_owner", {
      p_name: "Metering IT B",
      p_industry_template_id: "clinic",
    })
  ).data.id;
  await users.a.client
    .from("organization_members")
    .insert([{ organization_id: orgA, user_id: users.v.id, role: "viewer" }]);
  leadA = (
    await admin
      .from("leads")
      .insert({
        organization_id: orgA,
        name: "Lead A",
        score: 50,
        temperature: "warm",
        status: "new",
      })
      .select("id")
      .single()
  ).data.id;
});

after(async () => {
  if (!enabled) return;
  for (const o of [orgA, orgB]) if (o) await admin.from("organizations").delete().eq("id", o);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

test("records a usage row with the estimated cost", { skip }, async () => {
  const res = await recordAiUsage(
    usage("chat_reply", { leadId: leadA, requestId: crypto.randomUUID() }),
    { db: admin },
  );
  assert.equal(res.ok, true);

  const { data } = await admin
    .from("ai_usage_events")
    .select("model, input_tokens, output_tokens, estimated_cost_usd, request_type")
    .eq("organization_id", orgA)
    .eq("request_type", "chat_reply")
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data[0];
  assert.equal(row.input_tokens, 1000);
  assert.equal(row.output_tokens, 200);
  assert.equal(
    Number(row.estimated_cost_usd),
    estimateCostUsd({ model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 200 }),
  );
});

test("owner can read their org's usage; another org's owner cannot", { skip }, async () => {
  await recordAiUsage(usage("lead_extraction", { requestId: crypto.randomUUID() }), {
    db: admin,
  });

  const mine = await users.a.client
    .from("ai_usage_events")
    .select("id")
    .eq("organization_id", orgA);
  assert.ok((mine.data?.length ?? 0) >= 1);

  const cross = await users.b.client
    .from("ai_usage_events")
    .select("id")
    .eq("organization_id", orgA);
  assert.equal(cross.data?.length ?? 0, 0, "org B must not see org A usage");
});

test("a viewer cannot read usage events (owner/admin only)", { skip }, async () => {
  const asViewer = await users.v.client
    .from("ai_usage_events")
    .select("id")
    .eq("organization_id", orgA);
  assert.equal(asViewer.data?.length ?? 0, 0);
});

test("concurrent identical (org, request_id, request_type) records exactly one row", { skip }, async () => {
  const requestId = crypto.randomUUID();
  await Promise.all([
    recordAiUsage(usage("chat_reply", { requestId }), { db: admin }),
    recordAiUsage(usage("chat_reply", { requestId }), { db: admin }),
    recordAiUsage(usage("chat_reply", { requestId }), { db: admin }),
  ]);
  const { data } = await admin
    .from("ai_usage_events")
    .select("id")
    .eq("organization_id", orgA)
    .eq("request_id", requestId)
    .eq("request_type", "chat_reply");
  assert.equal(data.length, 1);
});

test("reply + extraction for the same turn are distinct rows", { skip }, async () => {
  const requestId = crypto.randomUUID();
  await recordAiUsage(usage("chat_reply", { requestId }), { db: admin });
  await recordAiUsage(usage("lead_extraction", { requestId }), { db: admin });
  const { data } = await admin
    .from("ai_usage_events")
    .select("request_type")
    .eq("organization_id", orgA)
    .eq("request_id", requestId);
  assert.equal(data.length, 2);
});

test("org_ai_usage_totals sums the current month for one org only", { skip }, async () => {
  const otherOrgId = orgB;
  // Noise in org B — must not affect org A's totals.
  await recordAiUsage(
    { ...usage("chat_reply"), organizationId: otherOrgId, requestId: crypto.randomUUID() },
    { db: admin },
  );

  const { startIso, endIso } = currentMonthRange();
  const before = (
    await admin.rpc("org_ai_usage_totals", { p_org_id: orgA, p_from: startIso, p_to: endIso })
  ).data[0];

  await recordAiUsage(
    usage("chat_reply", { requestId: crypto.randomUUID(), usage: { inputTokens: 5000, outputTokens: 1000 } }),
    { db: admin },
  );

  const after = (
    await admin.rpc("org_ai_usage_totals", { p_org_id: orgA, p_from: startIso, p_to: endIso })
  ).data[0];

  assert.equal(Number(after.total_requests) - Number(before.total_requests), 1);
  assert.equal(Number(after.total_input_tokens) - Number(before.total_input_tokens), 5000);
  assert.ok(Number(after.total_cost_usd) > Number(before.total_cost_usd));
});

test("owner can upsert usage limits; a viewer and another org cannot read them", { skip }, async () => {
  const up = await users.a.client
    .from("organization_usage_limits")
    .upsert(
      {
        organization_id: orgA,
        monthly_token_limit: 100_000,
        monthly_cost_limit_usd: 10,
        warning_threshold_percent: 75,
        hard_limit_enabled: true,
      },
      { onConflict: "organization_id" },
    )
    .select("organization_id");
  assert.equal(up.error, null);
  assert.equal(up.data.length, 1);

  const viewerRead = await users.v.client
    .from("organization_usage_limits")
    .select("monthly_token_limit")
    .eq("organization_id", orgA);
  assert.equal(viewerRead.data?.length ?? 0, 0);

  const crossRead = await users.b.client
    .from("organization_usage_limits")
    .select("monthly_token_limit")
    .eq("organization_id", orgA);
  assert.equal(crossRead.data?.length ?? 0, 0);
});

test("a viewer cannot write usage limits", { skip }, async () => {
  const res = await users.v.client
    .from("organization_usage_limits")
    .upsert(
      { organization_id: orgA, monthly_token_limit: 1 },
      { onConflict: "organization_id" },
    )
    .select("organization_id");
  assert.equal(res.data?.length ?? 0, 0);
});

test("checkUsageAllowed blocks once a hard cost limit is exceeded", { skip }, async () => {
  // orgA limit set above: cost limit $10, hard on. Push well past it.
  await recordAiUsage(
    usage("chat_reply", {
      requestId: crypto.randomUUID(),
      usage: { inputTokens: 10_000_000, outputTokens: 5_000_000 },
    }),
    { db: admin },
  );
  const gate = await checkUsageAllowed(orgA, { db: admin });
  assert.equal(gate.allowed, false);
  assert.equal(gate.state, "block");
});

test("checkUsageAllowed allows an org with no limits row", { skip }, async () => {
  const gate = await checkUsageAllowed(orgB, { db: admin });
  assert.equal(gate.allowed, true);
});
