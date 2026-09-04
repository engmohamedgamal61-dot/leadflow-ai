import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

/**
 * Real-Postgres tests for the dashboard/leads data access, focused on tenant
 * isolation and role-based writes. Every query here runs through a user-JWT
 * client (RLS enforced) — the same trust model the dashboard uses. Skipped
 * unless `LEADFLOW_DB_TEST_URL` + `_SERVICE_KEY` + a DISTINCT `_ANON_KEY`.
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
let archivedLeadId = "";
let aHotLeadId = "";
let bLeadId = "";

async function makeUser(tag: string) {
  const email = `leads-it-${tag}-${stamp}@example.test`;
  const password = "test-password-123";
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const client = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  users[tag] = { id: created.data.user.id, client };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await makeUser("a"); // owner of A
  await makeUser("b"); // owner of B
  await makeUser("c"); // viewer in A
  await makeUser("d"); // sales in A

  const a = await users.a.client.rpc("create_organization_with_owner", {
    p_name: "Leads IT Org A",
    p_industry_template_id: "real-estate",
  });
  if (a.error) throw a.error;
  orgA = a.data.id;

  const b = await users.b.client.rpc("create_organization_with_owner", {
    p_name: "Leads IT Org B",
    p_industry_template_id: "clinic",
  });
  if (b.error) throw b.error;
  orgB = b.data.id;

  // owner A adds C (viewer) and D (sales)
  const addC = await users.a.client
    .from("organization_members")
    .insert({ organization_id: orgA, user_id: users.c.id, role: "viewer" });
  if (addC.error) throw addC.error;
  const addD = await users.a.client
    .from("organization_members")
    .insert({ organization_id: orgA, user_id: users.d.id, role: "sales" });
  if (addD.error) throw addD.error;

  // Seed A's leads via the service role (data setup, not the code under test).
  const leads = await admin
    .from("leads")
    .insert([
      {
        organization_id: orgA,
        name: "Sara Hot",
        phone: "+966500000001",
        intent: "buy",
        custom_data: { budget: 2_000_000, financing: true },
        score: 90,
        temperature: "hot",
        status: "qualified",
        source: "chat",
      },
      {
        organization_id: orgA,
        name: "Warm Walid",
        email: "walid@example.test",
        intent: "rent",
        custom_data: { budget: 400_000 },
        score: 60,
        temperature: "warm",
        status: "new",
        source: "chat",
      },
      {
        organization_id: orgA,
        name: "Cold Carl",
        intent: null,
        custom_data: {},
        score: 10,
        temperature: "cold",
        status: "new",
        source: "chat",
      },
      {
        organization_id: orgA,
        name: "Archived Amy",
        intent: null,
        custom_data: {},
        score: 5,
        temperature: "cold",
        status: "archived",
        source: "chat",
      },
    ])
    .select("id");
  if (leads.error) throw leads.error;
  const hotLeadId = leads.data[0].id;
  archivedLeadId = leads.data[3].id;

  const conv = await admin
    .from("conversations")
    .insert({ organization_id: orgA, lead_id: hotLeadId, channel: "web" })
    .select("id")
    .single();
  if (conv.error) throw conv.error;
  await admin.from("messages").insert([
    { conversation_id: conv.data.id, role: "user", content: "I want a villa" },
    { conversation_id: conv.data.id, role: "assistant", content: "Noted!" },
  ]);
  await admin.from("lead_events").insert([
    {
      organization_id: orgA,
      lead_id: hotLeadId,
      event_type: "lead_created",
      metadata: { score: 90, temperature: "hot" },
    },
    {
      organization_id: orgA,
      lead_id: hotLeadId,
      event_type: "human_handoff_requested",
      metadata: { reason: "wants to negotiate price" },
    },
  ]);
  aHotLeadId = hotLeadId;
  const followUp = await admin
    .from("lead_follow_ups")
    .insert({
      organization_id: orgA,
      lead_id: hotLeadId,
      scheduled_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      status: "pending",
      source: "manual",
      channel: "chat",
    })
    .select("id")
    .single();
  if (followUp.error) throw followUp.error;

  // B gets one lead, plus its own follow-up / handoff event on it — used to
  // prove these joined-by-lead_id tables never leak across organizations.
  const bLead = await admin
    .from("leads")
    .insert({
      organization_id: orgB,
      name: "Omar B",
      score: 50,
      temperature: "warm",
      status: "new",
    })
    .select("id")
    .single();
  if (bLead.error) throw bLead.error;
  bLeadId = bLead.data.id;
  await admin.from("lead_events").insert({
    organization_id: orgB,
    lead_id: bLeadId,
    event_type: "human_handoff_requested",
    metadata: { reason: "billing question" },
  });
  await admin.from("lead_follow_ups").insert({
    organization_id: orgB,
    lead_id: bLeadId,
    scheduled_at: new Date(Date.now() - 86_400_000).toISOString(),
    status: "pending",
    source: "manual",
    channel: "chat",
  });
});

after(async () => {
  if (!enabled) return;
  for (const org of [orgA, orgB]) {
    if (org) await admin.from("organizations").delete().eq("id", org);
  }
  for (const u of Object.values(users)) {
    await admin.auth.admin.deleteUser(u.id);
  }
});

test("lead list returns only the caller's organization", { skip }, async () => {
  const a = await users.a.client
    .from("leads")
    .select("id, name, organization_id")
    .order("created_at", { ascending: false });
  assert.equal(a.error, null);
  assert.equal(a.data.length, 4);
  assert.ok(a.data.every((r: { organization_id: string }) => r.organization_id === orgA));
});

test("an explicit client-supplied organization_id cannot widen access", { skip }, async () => {
  // user B asks for org A's leads directly — RLS returns nothing.
  const probe = await users.b.client
    .from("leads")
    .select("id")
    .eq("organization_id", orgA);
  assert.deepEqual(probe.data, []);

  // and user B's own list is just B's one lead
  const own = await users.b.client.from("leads").select("id");
  assert.equal(own.data.length, 1);
});

test("stats counts are organization-scoped", { skip }, async () => {
  const c = (extra: (q: AnyClient) => AnyClient) =>
    extra(
      users.a.client.from("leads").select("id", { count: "exact", head: true }),
    );
  const [total, hot, warm, cold, qualified] = await Promise.all([
    c((q) => q),
    c((q) => q.eq("temperature", "hot")),
    c((q) => q.eq("temperature", "warm")),
    c((q) => q.eq("temperature", "cold")),
    c((q) => q.eq("status", "qualified")),
  ]);
  assert.equal(total.count, 4);
  assert.equal(hot.count, 1);
  assert.equal(warm.count, 1);
  assert.equal(cold.count, 2); // Cold Carl + Archived Amy
  assert.equal(qualified.count, 1);
});

test("search + temperature + status filters narrow results", { skip }, async () => {
  const search = await users.a.client
    .from("leads")
    .select("name")
    .or("name.ilike.%sara%,phone.ilike.%sara%,email.ilike.%sara%");
  assert.equal(search.data.length, 1);
  assert.equal(search.data[0].name, "Sara Hot");

  const warm = await users.a.client
    .from("leads")
    .select("name")
    .eq("temperature", "warm");
  assert.deepEqual(warm.data.map((r: { name: string }) => r.name), ["Warm Walid"]);

  const qualified = await users.a.client
    .from("leads")
    .select("name")
    .eq("status", "qualified");
  assert.deepEqual(qualified.data.map((r: { name: string }) => r.name), ["Sara Hot"]);
});

test("lead detail (lead + conversations + messages + events) is visible to a member", { skip }, async () => {
  const lead = await users.a.client
    .from("leads")
    .select("id")
    .eq("name", "Sara Hot")
    .single();
  const convs = await users.a.client
    .from("conversations")
    .select("id")
    .eq("lead_id", lead.data.id);
  assert.equal(convs.data.length, 1);
  const msgs = await users.a.client
    .from("messages")
    .select("role, content")
    .in("conversation_id", convs.data.map((c: { id: string }) => c.id))
    .order("created_at", { ascending: true });
  assert.deepEqual(msgs.data.map((m: { role: string }) => m.role), ["user", "assistant"]);
  const events = await users.a.client
    .from("lead_events")
    .select("event_type")
    .eq("lead_id", lead.data.id);
  assert.ok(events.data.some((e: { event_type: string }) => e.event_type === "lead_created"));
});

test("cross-tenant lead detail access is denied", { skip }, async () => {
  const aLead = await admin.from("leads").select("id").eq("organization_id", orgA).limit(1).single();
  const asB = await users.b.client
    .from("leads")
    .select("id")
    .eq("id", aLead.data.id)
    .maybeSingle();
  assert.equal(asB.data, null);

  const aConv = await admin.from("conversations").select("id").eq("organization_id", orgA).limit(1).single();
  const bMsgs = await users.b.client
    .from("messages")
    .select("id")
    .eq("conversation_id", aConv.data.id);
  assert.deepEqual(bMsgs.data, []);
  const bEvents = await users.b.client
    .from("lead_events")
    .select("id")
    .eq("lead_id", aLead.data.id);
  assert.deepEqual(bEvents.data, []);
});

test("viewer can read leads but cannot update status", { skip }, async () => {
  const lead = await users.c.client.from("leads").select("id, status").eq("name", "Cold Carl").single();
  assert.equal(lead.error, null); // viewer reads fine
  const upd = await users.c.client
    .from("leads")
    .update({ status: "won" })
    .eq("organization_id", orgA)
    .eq("id", lead.data.id)
    .select("id");
  assert.ok(upd.error || (upd.data ?? []).length === 0, "viewer update must be blocked");
  const after = await admin.from("leads").select("status").eq("id", lead.data.id).single();
  assert.equal(after.data.status, "new");
});

test("sales member can update lead status", { skip }, async () => {
  const lead = await admin.from("leads").select("id").eq("name", "Warm Walid").single();
  const upd = await users.d.client
    .from("leads")
    .update({ status: "contacted" })
    .eq("organization_id", orgA)
    .eq("id", lead.data.id)
    .select("id");
  assert.equal(upd.error, null);
  assert.equal(upd.data.length, 1);
  const after = await admin.from("leads").select("status").eq("id", lead.data.id).single();
  assert.equal(after.data.status, "contacted");

  // and can append the timeline event the dashboard action writes
  const ev = await users.d.client.from("lead_events").insert({
    organization_id: orgA,
    lead_id: lead.data.id,
    event_type: "status_changed",
    metadata: { from: "new", to: "contacted" },
  });
  assert.equal(ev.error, null);
});

test("owner can update lead status across their org", { skip }, async () => {
  const lead = await admin.from("leads").select("id").eq("name", "Sara Hot").single();
  const upd = await users.a.client
    .from("leads")
    .update({ status: "won" })
    .eq("organization_id", orgA)
    .eq("id", lead.data.id)
    .select("id");
  assert.equal(upd.error, null);
  assert.equal(upd.data.length, 1);
});

test("a writer in org B cannot update a lead in org A", { skip }, async () => {
  const aLead = await admin.from("leads").select("id, status").eq("organization_id", orgA).limit(1).single();
  const upd = await users.b.client
    .from("leads")
    .update({ status: "archived" })
    .eq("id", aLead.data.id)
    .select("id");
  assert.ok(upd.error || (upd.data ?? []).length === 0);
  const after = await admin.from("leads").select("status").eq("id", aLead.data.id).single();
  assert.notEqual(after.data.status, "archived");
});

// ── Next Best Action / lost-lead insight candidate scan (getLeadInsightCandidates) ──
// Exercises the exact query shapes that function issues, via the same
// user-JWT/RLS-enforced clients as the rest of this file.

test("insight candidate scan excludes closed-status leads (won/lost/archived)", { skip }, async () => {
  const all = await admin.from("leads").select("id, status").eq("organization_id", orgA);
  const closedIds = new Set(
    all.data
      .filter((r: { status: string }) => ["won", "lost", "archived"].includes(r.status))
      .map((r: { id: string }) => r.id),
  );
  assert.ok(closedIds.has(archivedLeadId), "Archived Amy must be closed-status");

  const candidates = await users.a.client
    .from("leads")
    .select("id, status")
    .eq("organization_id", orgA)
    .not("status", "in", "(won,lost,archived)");
  assert.equal(candidates.error, null);
  assert.equal(candidates.data.length, all.data.length - closedIds.size);
  assert.ok(!candidates.data.some((r: { id: string }) => closedIds.has(r.id)));
  assert.ok(
    candidates.data.every(
      (r: { status: string }) => !["won", "lost", "archived"].includes(r.status),
    ),
  );
});

test("insight signal tables (follow-ups, appointments, handoff events) joined by lead_id never leak across organizations", { skip }, async () => {
  // Org A's client, scoped to org A + its own lead ids, sees only its own rows.
  const aFollowUps = await users.a.client
    .from("lead_follow_ups")
    .select("lead_id, status")
    .eq("organization_id", orgA)
    .eq("status", "pending")
    .in("lead_id", [aHotLeadId, bLeadId]);
  assert.equal(aFollowUps.error, null);
  assert.ok(aFollowUps.data.every((r: { lead_id: string }) => r.lead_id === aHotLeadId));
  assert.ok(!aFollowUps.data.some((r: { lead_id: string }) => r.lead_id === bLeadId));

  const aHandoffs = await users.a.client
    .from("lead_events")
    .select("lead_id")
    .eq("organization_id", orgA)
    .eq("event_type", "human_handoff_requested")
    .in("lead_id", [aHotLeadId, bLeadId]);
  assert.equal(aHandoffs.error, null);
  assert.ok(aHandoffs.data.every((r: { lead_id: string }) => r.lead_id === aHotLeadId));

  // Org B's client cannot see org A's follow-up/handoff rows even when it
  // knows org A's lead id and asks by lead_id directly (RLS, not app filtering).
  const bProbeFollowUps = await users.b.client
    .from("lead_follow_ups")
    .select("id")
    .in("lead_id", [aHotLeadId]);
  assert.deepEqual(bProbeFollowUps.data, []);

  const bProbeHandoffs = await users.b.client
    .from("lead_events")
    .select("id")
    .eq("event_type", "human_handoff_requested")
    .in("lead_id", [aHotLeadId]);
  assert.deepEqual(bProbeHandoffs.data, []);

  // And org B's own scoped query sees exactly its own follow-up / handoff event.
  const bOwnFollowUps = await users.b.client
    .from("lead_follow_ups")
    .select("lead_id")
    .eq("organization_id", orgB)
    .eq("status", "pending");
  assert.deepEqual(bOwnFollowUps.data.map((r: { lead_id: string }) => r.lead_id), [bLeadId]);

  const bOwnHandoffs = await users.b.client
    .from("lead_events")
    .select("lead_id")
    .eq("organization_id", orgB)
    .eq("event_type", "human_handoff_requested");
  assert.deepEqual(bOwnHandoffs.data.map((r: { lead_id: string }) => r.lead_id), [bLeadId]);
});
