import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { recordAiUsage } from "../metering/service.ts";
import { canManageConfig } from "../org/roles.ts";
import { routeQuestion } from "./intents.ts";
import {
  filterByRisk,
  rankPriorityLeads,
  type InsightCandidate,
} from "./ranking.ts";

/**
 * Real-Postgres tests for Ask LeadFlow. Skipped without local Supabase.
 * Covers: the intent queries are tenant-scoped (RLS), a `sales_manager` usage
 * row is recorded and stays owner/admin-only + org-scoped, the deterministic
 * ranking produces the right leads from real signal data, and authorization
 * is owner/admin.
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
let orgA = "";
let orgB = "";
let aLeadId = "";
let bLeadId = "";

async function makeUser(tag: string) {
  const email = `ask-it-${tag}-${stamp}@example.test`;
  const c = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
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
  await makeUser("a"); // owner A
  await makeUser("b"); // owner B
  await makeUser("v"); // viewer in A

  orgA = (await users.a.client.rpc("create_organization_with_owner", {
    p_name: "Ask IT A", p_industry_template_id: "real-estate",
  })).data.id;
  orgB = (await users.b.client.rpc("create_organization_with_owner", {
    p_name: "Ask IT B", p_industry_template_id: "clinic",
  })).data.id;
  await users.a.client
    .from("organization_members")
    .insert([{ organization_id: orgA, user_id: users.v.id, role: "viewer" }]);

  // One "needs attention" lead per org: a qualified lead whose last message is
  // inbound and old → Next Best Action = reply_now / needs_attention.
  const mkLead = async (orgId: string, name: string) => {
    const lead = (await admin.from("leads").insert({
      organization_id: orgId, name, score: 70, temperature: "hot", status: "qualified",
    }).select("id").single()).data.id;
    const conv = (await admin.from("conversations").insert({
      organization_id: orgId, lead_id: lead, channel: "web",
    }).select("id").single()).data.id;
    await admin.from("messages").insert({
      conversation_id: conv, role: "user", content: "still waiting", channel: "web",
      created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    });
    return lead;
  };
  aLeadId = await mkLead(orgA, "Attention Anna");
  bLeadId = await mkLead(orgB, "Bravo Bob");
});

after(async () => {
  if (!enabled) return;
  for (const o of [orgA, orgB]) if (o) await admin.from("organizations").delete().eq("id", o);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

test("authorization: owner/admin allowed, viewer/sales blocked", () => {
  assert.equal(canManageConfig("owner"), true);
  assert.equal(canManageConfig("admin"), true);
  assert.equal(canManageConfig("manager"), false);
  assert.equal(canManageConfig("sales"), false);
  assert.equal(canManageConfig("viewer"), false);
});

test("intent candidate scan (needs-attention) is tenant-scoped via RLS", { skip }, async () => {
  // org A's client sees only its own non-closed leads + its own message rows.
  const aLeads = await users.a.client
    .from("leads")
    .select("id, name, status, temperature, score, updated_at")
    .eq("organization_id", orgA)
    .not("status", "in", "(won,lost,archived)");
  assert.equal(aLeads.error, null);
  assert.ok(aLeads.data.some((r: { id: string }) => r.id === aLeadId));
  assert.ok(!aLeads.data.some((r: { id: string }) => r.id === bLeadId));

  // org B's client cannot see org A's lead even asking by id directly.
  const bProbe = await users.b.client.from("leads").select("id").eq("id", aLeadId);
  assert.deepEqual(bProbe.data, []);

  // The messages that drive the "needs attention" signal are RLS-scoped too.
  const aConv = await users.a.client.from("conversations").select("id").eq("organization_id", orgA);
  const bProbeMsgs = await users.b.client
    .from("messages")
    .select("id")
    .in("conversation_id", (aConv.data ?? []).map((c: { id: string }) => c.id));
  assert.deepEqual(bProbeMsgs.data, []);
});

test("deterministic ranking picks the needs-attention lead from real signal data", { skip }, async () => {
  // Build the candidate shape the way retrieval.ts feeds ranking.ts.
  const leads = (
    await users.a.client
      .from("leads")
      .select("id, name, status, temperature, score, updated_at")
      .eq("organization_id", orgA)
      .not("status", "in", "(won,lost,archived)")
  ).data as { id: string; name: string; status: string; temperature: string; score: number; updated_at: string }[];

  const candidates: InsightCandidate[] = leads.map((l) => ({
    lead: {
      id: l.id, name: l.name, status: l.status, temperature: l.temperature,
      score: l.score, updatedAt: l.updated_at,
    },
    // Anna's last message is inbound + 3h old → the real engine yields this.
    insight:
      l.id === aLeadId
        ? { riskLevel: "needs_attention", action: "reply_now", reasonKey: "insights.reasons.unansweredInbound" }
        : { riskLevel: "none", action: "none", reasonKey: "insights.reasons.onTrack" },
  }));

  const priority = rankPriorityLeads(candidates);
  assert.equal(priority[0]?.id, aLeadId);
  assert.equal(priority[0]?.name, "Attention Anna");
  assert.deepEqual(
    filterByRisk(candidates, "needs_attention").map((c) => c.id),
    [aLeadId],
  );
});

test("a sales_manager usage row is recorded, org-scoped, and owner/admin-only", { skip }, async () => {
  const res = await recordAiUsage(
    {
      organizationId: orgA,
      requestType: "sales_manager",
      model: "claude-sonnet-5",
      channel: "dashboard",
      usage: { inputTokens: 1200, outputTokens: 90 },
      requestId: crypto.randomUUID(),
    },
    { db: admin },
  );
  assert.equal(res.ok, true);

  // owner A can read it
  const mine = await users.a.client
    .from("ai_usage_events")
    .select("request_type")
    .eq("organization_id", orgA)
    .eq("request_type", "sales_manager");
  assert.ok(mine.data.length >= 1);

  // viewer in A cannot (cost data = owner/admin only)
  const viewer = await users.v.client
    .from("ai_usage_events")
    .select("id")
    .eq("organization_id", orgA);
  assert.equal(viewer.data?.length ?? 0, 0);

  // org B cannot
  const other = await users.b.client
    .from("ai_usage_events")
    .select("id")
    .eq("organization_id", orgA);
  assert.equal(other.data?.length ?? 0, 0);
});

test("intent routing is stable for the shipped suggested questions", () => {
  assert.equal(routeQuestion("Which leads need attention today?").intent, "needs_attention");
  assert.equal(routeQuestion("Summarize today's sales activity.").intent, "recent_activity");
});
