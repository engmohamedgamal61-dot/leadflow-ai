import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

/**
 * Real-Postgres tests for the follow-up scheduler: atomic claiming under
 * concurrency, the retry/failure lifecycle, cancellation safety and tenant
 * isolation. Skipped without local Supabase.
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const enabled = Boolean(URL && SERVICE_KEY && ANON_KEY && ANON_KEY !== SERVICE_KEY);
const skip = enabled
  ? false
  : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY + LEADFLOW_DB_TEST_ANON_KEY";

// The WhatsApp follow-up adapter (reached via the scheduler's default registry)
// must use the mock Meta transport and be able to decrypt a stored token.
process.env.WHATSAPP_MOCK_TRANSPORT = "1";
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY ??= "d".repeat(64);

const { runFollowUpScheduler } = await import("./scheduler.ts");
import type { RunSchedulerOptions } from "./scheduler.ts";
const { internalAdapter } = await import("./channels.ts");
import type { FollowUpChannelAdapter } from "./channels.ts";
const { encryptToken } = await import("../whatsapp/crypto.ts");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
const stamp = Date.now();
let admin: AnyClient;
let orgRE = "", orgClinic = "", demoOrg = "";
let leadRE = "", leadClinic = "", leadDemo = "";
let convRE = "";
let userId = "";

const run = (opts: RunSchedulerOptions = {}) => runFollowUpScheduler({ db: admin, ...opts });

const past = () => new Date(Date.now() - 3_600_000).toISOString();
const future = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

const failing: FollowUpChannelAdapter = {
  name: "internal",
  deliver: async () => ({ ok: false, retryable: true, detail: "mock failure" }),
};
const hardFail: FollowUpChannelAdapter = {
  name: "internal",
  deliver: async () => ({ ok: false, retryable: false, detail: "permanent" }),
};

async function newFollowUp(
  orgId: string,
  leadId: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from("lead_follow_ups")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      scheduled_at: past(),
      status: "pending",
      source: "manual",
      ...over,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const u = await admin.auth.admin.createUser({
    email: `sched-it-${stamp}@example.test`,
    password: "test-password-123",
    email_confirm: true,
  });
  userId = u.data.user.id;

  const mkOrg = async (slug: string, tpl: string, withMember: boolean) => {
    const org = (
      await admin
        .from("organizations")
        .insert({ name: slug, slug: `${slug}-${stamp}`, industry_template_id: tpl })
        .select("id")
        .single()
    ).data.id;
    if (withMember) {
      await admin
        .from("organization_members")
        .insert({ organization_id: org, user_id: userId, role: "owner" });
    }
    const lead = (
      await admin
        .from("leads")
        .insert({
          organization_id: org,
          name: `${slug} Lead`,
          score: 50,
          temperature: "warm",
          status: "new",
        })
        .select("id")
        .single()
    ).data.id;
    return { org, lead };
  };

  ({ org: orgRE, lead: leadRE } = await mkOrg("sched-re", "real-estate", true));
  ({ org: orgClinic, lead: leadClinic } = await mkOrg("sched-clinic", "clinic", true));
  ({ org: demoOrg, lead: leadDemo } = await mkOrg("sched-demo", "real-estate", false));

  // A connected WhatsApp org + an in-session-window conversation for leadRE,
  // so a `channel = whatsapp` follow-up routes through the real adapter
  // (mock Meta transport).
  await admin.from("whatsapp_connections").insert({
    organization_id: orgRE,
    phone_number_id: `PN-SCHED-${stamp}`,
    status: "connected",
    access_token_encrypted: encryptToken(
      "meta-token-value-1234567890",
      process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY as string,
    ),
  });
  convRE = (
    await admin
      .from("conversations")
      .insert({
        organization_id: orgRE,
        lead_id: leadRE,
        channel: "whatsapp",
        external_contact_id: "16505550123",
        last_inbound_at: new Date().toISOString(),
      })
      .select("id")
      .single()
  ).data.id;
});

after(async () => {
  if (!enabled) return;
  for (const o of [orgRE, orgClinic, demoOrg]) {
    if (o) await admin.from("organizations").delete().eq("id", o);
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
});

beforeEach(async () => {
  if (!enabled) return;
  // wipe follow-ups + events between tests for isolation
  for (const o of [orgRE, orgClinic, demoOrg]) {
    await admin.from("lead_follow_ups").delete().eq("organization_id", o);
    await admin.from("lead_events").delete().eq("organization_id", o);
  }
  if (convRE) {
    await admin.from("messages").delete().eq("conversation_id", convRE);
    await admin
      .from("conversations")
      .update({ last_inbound_at: new Date().toISOString() })
      .eq("id", convRE);
  }
});

const statusOf = async (id: string) =>
  (await admin.from("lead_follow_ups").select("status, attempt_count, completed_at, last_error, next_attempt_at").eq("id", id).single()).data;

const eventsOf = async (leadId: string, type: string) =>
  (await admin.from("lead_events").select("id").eq("lead_id", leadId).eq("event_type", type)).data;

test("a future pending follow-up is NOT claimed", { skip }, async () => {
  const id = await newFollowUp(orgRE, leadRE, { scheduled_at: future() });
  const summary = await run();
  assert.equal(summary.claimed, 0);
  assert.equal((await statusOf(id)).status, "pending");
});

test("a due pending follow-up is claimed and completed, with one event", { skip }, async () => {
  const id = await newFollowUp(orgRE, leadRE, { source: "chat" });
  const summary = await run();
  assert.equal(summary.claimed, 1);
  assert.equal(summary.completed, 1);
  const row = await statusOf(id);
  assert.equal(row.status, "completed");
  assert.equal(row.attempt_count, 1);
  assert.ok(row.completed_at);
  assert.equal((await eventsOf(leadRE, "follow_up_executed")).length, 1);

  // running again does nothing (idempotent)
  const again = await run();
  assert.equal(again.claimed, 0);
  assert.equal((await eventsOf(leadRE, "follow_up_executed")).length, 1);
});

test("cancelled and completed follow-ups are never claimed", { skip }, async () => {
  const cancelled = await newFollowUp(orgRE, leadRE, { status: "cancelled" });
  const completed = await newFollowUp(orgRE, leadRE, { status: "completed" });
  const summary = await run();
  assert.equal(summary.claimed, 0);
  assert.equal((await statusOf(cancelled)).status, "cancelled");
  assert.equal((await statusOf(completed)).status, "completed");
});

test("cancellation before a run wins: the row is never executed", { skip }, async () => {
  const id = await newFollowUp(orgRE, leadRE);
  // user cancels (same transition the dashboard action uses)
  await admin.from("lead_follow_ups").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
  const summary = await run();
  assert.equal(summary.claimed, 0);
  assert.equal((await statusOf(id)).status, "cancelled");
  assert.equal((await eventsOf(leadRE, "follow_up_executed")).length, 0);
});

test("concurrent scheduler runs never execute the same row twice", { skip }, async () => {
  const ids = await Promise.all(
    Array.from({ length: 12 }, () => newFollowUp(orgRE, leadRE)),
  );
  const runs = await Promise.all(
    Array.from({ length: 5 }, () => run()),
  );
  const totalClaimed = runs.reduce((n, r) => n + r.claimed, 0);
  const totalCompleted = runs.reduce((n, r) => n + r.completed, 0);
  assert.equal(totalClaimed, 12, "each row claimed exactly once across all runs");
  assert.equal(totalCompleted, 12);
  for (const id of ids) {
    assert.equal((await statusOf(id)).status, "completed");
  }
  assert.equal((await eventsOf(leadRE, "follow_up_executed")).length, 12);
});

test("batch limit bounds one run", { skip }, async () => {
  await Promise.all(Array.from({ length: 7 }, () => newFollowUp(orgRE, leadRE)));
  const first = await run({ batchSize: 3 });
  assert.equal(first.claimed, 3);
  const second = await run({ batchSize: 3 });
  assert.equal(second.claimed, 3);
  const third = await run({ batchSize: 3 });
  assert.equal(third.claimed, 1);
});

test("retryable adapter failure -> pending with a future next_attempt_at + retry event", { skip }, async () => {
  const id = await newFollowUp(orgRE, leadRE);
  const summary = await run({ adapters: { internal: failing } });
  assert.equal(summary.retryScheduled, 1);
  const row = await statusOf(id);
  assert.equal(row.status, "pending");
  assert.equal(row.attempt_count, 1);
  assert.equal(row.last_error, "mock failure");
  assert.ok(new Date(row.next_attempt_at).getTime() > Date.now());
  assert.equal((await eventsOf(leadRE, "follow_up_retry_scheduled")).length, 1);
  // not due again yet
  assert.equal((await run({ adapters: { internal: failing } })).claimed, 0);
});

test("attempts are exhausted -> failed (terminal)", { skip }, async () => {
  const id = await newFollowUp(orgRE, leadRE);
  for (let i = 0; i < 3; i += 1) {
    await admin.from("lead_follow_ups").update({ next_attempt_at: past() }).eq("id", id);
    await run({ adapters: { internal: failing }, maxAttempts: 3 });
  }
  const row = await statusOf(id);
  assert.equal(row.status, "failed");
  assert.equal(row.attempt_count, 3);
  assert.equal((await eventsOf(leadRE, "follow_up_failed")).length, 1);
  // failed rows are never re-claimed
  assert.equal((await run({ adapters: { internal: failing } })).claimed, 0);
});

test("a non-retryable failure fails immediately", { skip }, async () => {
  const id = await newFollowUp(orgRE, leadRE);
  const summary = await run({ adapters: { internal: hardFail } });
  assert.equal(summary.failed, 1);
  assert.equal((await statusOf(id)).status, "failed");
});

test("tenant isolation: a per-org run processes each org's rows, no cross-effect", { skip }, async () => {
  const re = await newFollowUp(orgRE, leadRE);
  const clinic = await newFollowUp(orgClinic, leadClinic);
  const demo = await newFollowUp(demoOrg, leadDemo);
  const summary = await run();
  assert.equal(summary.claimed, 3);
  assert.equal(summary.completed, 3);
  assert.equal((await statusOf(re)).status, "completed");
  assert.equal((await statusOf(clinic)).status, "completed");
  assert.equal((await statusOf(demo)).status, "completed");
  // each event landed on its own org / lead
  assert.equal((await eventsOf(leadRE, "follow_up_executed")).length, 1);
  assert.equal((await eventsOf(leadClinic, "follow_up_executed")).length, 1);
  assert.equal((await eventsOf(leadDemo, "follow_up_executed")).length, 1);
  const reEvents = (await admin.from("lead_events").select("id").eq("organization_id", orgRE)).data;
  assert.equal(reEvents.length, 1, "org RE has only its own event");
});

test("agent-created (source=chat) and manual follow-ups are both claimed", { skip }, async () => {
  await newFollowUp(orgRE, leadRE, { source: "chat" });
  await newFollowUp(orgRE, leadRE, { source: "manual" });
  const summary = await run();
  assert.equal(summary.claimed, 2);
  assert.equal(summary.completed, 2);
});

test("demo org (no members) executes through the internal adapter with no error", { skip }, async () => {
  const id = await newFollowUp(demoOrg, leadDemo, { channel: "whatsapp" });
  const summary = await run();
  assert.equal(summary.completed, 1);
  const row = await statusOf(id);
  assert.equal(row.status, "completed");
  const ev = (await admin.from("lead_events").select("metadata").eq("lead_id", leadDemo).eq("event_type", "follow_up_executed").single()).data;
  assert.equal((ev.metadata as { channel?: string }).channel, "internal", "demo forced onto internal channel");
});

test("a channel=whatsapp follow-up routes through the WhatsApp adapter (mock transport)", { skip }, async () => {
  const id = await newFollowUp(orgRE, leadRE, {
    channel: "whatsapp",
    conversation_id: convRE,
    note: "Checking in as promised.",
  });
  const summary = await run();
  assert.equal(summary.completed, 1);
  assert.equal((await statusOf(id)).status, "completed");

  // the adapter persisted the outbound message with Meta provider metadata
  const msgs = (
    await admin
      .from("messages")
      .select("role, channel, provider, provider_message_id, delivery_status")
      .eq("conversation_id", convRE)
  ).data;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].channel, "whatsapp");
  assert.equal(msgs[0].provider, "meta_cloud");
  assert.equal(msgs[0].delivery_status, "sent");
  assert.match(msgs[0].provider_message_id, /^wamid\.mock-/);

  // re-running does not re-send (row already completed)
  await run();
  assert.equal(
    (await admin.from("messages").select("id").eq("conversation_id", convRE)).data.length,
    1,
  );
});

test("a retryable WhatsApp adapter failure still uses the Phase G retry policy", { skip }, async () => {
  const id = await newFollowUp(orgRE, leadRE, { channel: "whatsapp", conversation_id: convRE });
  const summary = await run({ adapters: { whatsapp: failing } });
  assert.equal(summary.retryScheduled, 1);
  const row = await statusOf(id);
  assert.equal(row.status, "pending");
  assert.ok(new Date(row.next_attempt_at).getTime() > Date.now());
  assert.equal((await eventsOf(leadRE, "follow_up_retry_scheduled")).length, 1);
});

test("the real internal adapter is a no-op success (sanity)", { skip }, async () => {
  const r = await internalAdapter.deliver({
    db: admin, organizationId: "o", leadId: "l", conversationId: null, channel: "internal", message: "hi", isDemo: true,
  });
  assert.deepEqual(r, { ok: true, retryable: false });
});
