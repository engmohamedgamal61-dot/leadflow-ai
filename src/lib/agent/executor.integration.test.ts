import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  markQualified,
  createFollowUp,
  requestHumanHandoff,
  executeAgentActions,
  type AgentExecContext,
} from "./executor.ts";

/**
 * Real-Postgres tests for the agent action executor: idempotency, tenant
 * isolation and role enforcement (all via RLS-scoped user clients — the same
 * trust model the dashboard uses). Skipped without local Supabase.
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
let orgA = "", orgB = "", leadA = "", leadB = "";

const future = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

async function makeUser(tag: string) {
  const email = `exec-it-${tag}-${stamp}@example.test`;
  const c = await admin.auth.admin.createUser({
    email, password: "test-password-123", email_confirm: true,
  });
  if (c.error) throw c.error;
  const client = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const s = await client.auth.signInWithPassword({ email, password: "test-password-123" });
  if (s.error) throw s.error;
  users[tag] = { id: c.data.user.id, client };
}

function ctx(
  client: AnyClient,
  organizationId: string,
  leadId: string,
  requestId: string | null,
): AgentExecContext {
  return { db: client, organizationId, leadId, conversationId: null, requestId, source: "chat" };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await makeUser("a"); // owner A
  await makeUser("b"); // owner B
  await makeUser("v"); // viewer A
  await makeUser("s"); // sales A

  orgA = (await users.a.client.rpc("create_organization_with_owner", {
    p_name: "Exec IT A", p_industry_template_id: "real-estate",
  })).data.id;
  orgB = (await users.b.client.rpc("create_organization_with_owner", {
    p_name: "Exec IT B", p_industry_template_id: "clinic",
  })).data.id;

  await users.a.client.from("organization_members").insert([
    { organization_id: orgA, user_id: users.v.id, role: "viewer" },
    { organization_id: orgA, user_id: users.s.id, role: "sales" },
  ]);

  leadA = (await admin.from("leads").insert({
    organization_id: orgA, name: "Lead A", score: 50, temperature: "warm", status: "new",
  }).select("id").single()).data.id;
  leadB = (await admin.from("leads").insert({
    organization_id: orgB, name: "Lead B", score: 50, temperature: "warm", status: "new",
  }).select("id").single()).data.id;
});

after(async () => {
  if (!enabled) return;
  for (const o of [orgA, orgB]) if (o) await admin.from("organizations").delete().eq("id", o);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

test("mark_qualified applies once and is idempotent", { skip }, async () => {
  const rid = crypto.randomUUID();
  const first = await markQualified(ctx(users.a.client, orgA, leadA, rid));
  assert.equal(first.status, "executed");

  const status1 = (await admin.from("leads").select("status").eq("id", leadA).single()).data.status;
  assert.equal(status1, "qualified");

  const again = await markQualified(ctx(users.a.client, orgA, leadA, rid));
  assert.equal(again.status, "skipped");

  const qualifiedEvents = (await admin
    .from("lead_events").select("id").eq("lead_id", leadA).eq("event_type", "lead_qualified")).data;
  assert.equal(qualifiedEvents.length, 1, "no duplicate lead_qualified event");
});

test("create_follow_up: future date accepted, duplicate request is a no-op", { skip }, async () => {
  const rid = crypto.randomUUID();
  const when = future();
  const a = await createFollowUp(ctx(users.a.client, orgA, leadA, rid), { scheduledAt: when, note: "call back" });
  assert.equal(a.status, "executed");
  assert.ok(a.followUpId);

  // same requestId again → collapsed
  const b = await createFollowUp(ctx(users.a.client, orgA, leadA, rid), { scheduledAt: when, note: "call back" });
  assert.equal(b.status, "skipped");
  assert.equal(b.followUpId, a.followUpId);

  const rows = (await admin.from("lead_follow_ups").select("id, status, scheduled_at, source").eq("lead_id", leadA)).data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].source, "chat");

  const events = (await admin.from("lead_events").select("id").eq("lead_id", leadA).eq("event_type", "follow_up_created")).data;
  assert.equal(events.length, 1, "one follow_up_created event");
});

test("human handoff is idempotent per request", { skip }, async () => {
  const rid = crypto.randomUUID();
  const first = await requestHumanHandoff(ctx(users.a.client, orgA, leadA, rid), { reason: "wants a person" });
  assert.equal(first.status, "executed");
  const dup = await requestHumanHandoff(ctx(users.a.client, orgA, leadA, rid), { reason: "wants a person" });
  assert.equal(dup.status, "skipped");

  const events = (await admin.from("lead_events").select("id, metadata").eq("lead_id", leadA).eq("event_type", "human_handoff_requested")).data;
  assert.equal(events.length, 1);
});

test("concurrent identical turns do not create duplicate follow-ups", { skip }, async () => {
  const org = (await admin.from("organizations").insert({
    name: "Exec IT C", slug: `exec-it-c-${stamp}`, industry_template_id: "real-estate",
  }).select("id").single()).data;
  await admin.from("organization_members").insert({ organization_id: org.id, user_id: users.a.id, role: "owner" });
  const lead = (await admin.from("leads").insert({
    organization_id: org.id, name: "C", score: 10, temperature: "cold", status: "new",
  }).select("id").single()).data;
  try {
    const rid = crypto.randomUUID();
    const when = future();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createFollowUp(ctx(users.a.client, org.id, lead.id, rid), { scheduledAt: when }),
      ),
    );
    const ids = new Set(results.map((r) => r.followUpId));
    assert.equal(ids.size, 1, "all five collapsed to one follow-up");
    const rows = (await admin.from("lead_follow_ups").select("id").eq("lead_id", lead.id)).data;
    assert.equal(rows.length, 1);
  } finally {
    await admin.from("organizations").delete().eq("id", org.id);
  }
});

test("tenant A cannot read or write tenant B follow-ups", { skip }, async () => {
  // A writes a follow-up on B's lead → RLS blocks
  const write = await createFollowUp(ctx(users.a.client, orgB, leadB, crypto.randomUUID()), {
    scheduledAt: future(),
  });
  assert.equal(write.status, "failed");

  // seed a real follow-up on B via admin, then A tries to read it
  await admin.from("lead_follow_ups").insert({
    organization_id: orgB, lead_id: leadB, scheduled_at: future(), status: "pending",
  });
  const read = await users.a.client.from("lead_follow_ups").select("id").eq("organization_id", orgB);
  assert.deepEqual(read.data, []);
});

test("viewer cannot create a follow-up / mark qualified; sales can", { skip }, async () => {
  const viewerFollow = await createFollowUp(ctx(users.v.client, orgA, leadA, crypto.randomUUID()), {
    scheduledAt: future(),
  });
  assert.equal(viewerFollow.status, "failed");

  const viewerQualify = await markQualified(ctx(users.v.client, orgA, leadA, crypto.randomUUID()));
  assert.notEqual(viewerQualify.status, "executed");

  // sales is a write role in the existing RLS model
  const salesFollow = await createFollowUp(ctx(users.s.client, orgA, leadA, crypto.randomUUID()), {
    scheduledAt: future(),
  });
  assert.equal(salesFollow.status, "executed");
});

test("executeAgentActions runs mark_qualified + proposed actions together", { skip }, async () => {
  const org = (await admin.from("organizations").insert({
    name: "Exec IT D", slug: `exec-it-d-${stamp}`, industry_template_id: "real-estate",
  }).select("id").single()).data;
  await admin.from("organization_members").insert({ organization_id: org.id, user_id: users.a.id, role: "owner" });
  const lead = (await admin.from("leads").insert({
    organization_id: org.id, name: "D", score: 90, temperature: "hot", status: "contacted",
  }).select("id").single()).data;
  try {
    const outcomes = await executeAgentActions(
      ctx(users.a.client, org.id, lead.id, crypto.randomUUID()),
      {
        markQualified: true,
        proposedActions: [
          { type: "create_follow_up", scheduledAt: future(), reason: "callback next week" },
          { type: "request_human_handoff", reason: "complex financing question" },
        ],
      },
    );
    assert.equal(outcomes.length, 3);
    assert.ok(outcomes.every((o) => o.status === "executed"));
    const status = (await admin.from("leads").select("status").eq("id", lead.id).single()).data.status;
    assert.equal(status, "qualified");
    const evTypes = (await admin.from("lead_events").select("event_type").eq("lead_id", lead.id))
      .data.map((e: { event_type: string }) => e.event_type).sort();
    assert.deepEqual(
      [...new Set(evTypes)].sort(),
      ["follow_up_created", "human_handoff_requested", "lead_qualified", "status_changed"],
    );
  } finally {
    await admin.from("organizations").delete().eq("id", org.id);
  }
});
