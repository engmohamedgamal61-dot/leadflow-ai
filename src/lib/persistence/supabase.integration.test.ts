import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { persistChatTurn } from "./persist.ts";
import type { LeadData } from "../../types/chat.ts";

/**
 * Realistic persistence tests against a real Postgres. Skipped unless
 * `LEADFLOW_DB_TEST_URL` + `LEADFLOW_DB_TEST_SERVICE_KEY` are set (point them at
 * a local `supabase start` instance — never a production project).
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const enabled = Boolean(URL && KEY);
const skip = enabled ? false : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let orgId = "";
const SLUG = `it-${Date.now()}`;

before(async () => {
  if (!enabled) return;
  db = createClient(URL as string, KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await db
    .from("organizations")
    .insert({
      name: "Integration Test Org",
      slug: SLUG,
      industry_template_id: "real-estate",
    })
    .select("id")
    .single();
  if (error) throw error;
  orgId = data.id;
});

after(async () => {
  if (!enabled || !orgId) return;
  // cascades to members/configs/leads/conversations/messages/lead_events
  await db.from("organizations").delete().eq("id", orgId);
});

const reLead: LeadData = {
  name: "محمد",
  phone: null,
  email: null,
  intent: "buy",
  customData: {
    location: "Riyadh",
    budget: 1_000_000,
    property_type: "apartment",
    bedrooms: 4,
    financing: true,
    timeline: "1 week",
  },
};

test("persists a lead, conversation, messages and events; reuses on turn 2", { skip }, async () => {
  // ── turn 1 (new) ──
  const t1 = await persistChatTurn(db, {
    organizationId: orgId,
    conversationId: null,
    channel: "web",
    source: "chat",
    userMessage: "I want a 4-bed apartment in Riyadh",
    assistantMessage: "Great — what is your budget?",
    lead: { ...reLead, customData: { location: "Riyadh", property_type: "apartment" } },
    score: 35,
    temperature: "COLD",
  });

  const lead1 = await db.from("leads").select("*").eq("id", t1.leadId).single();
  assert.equal(lead1.error, null);
  assert.equal(lead1.data.organization_id, orgId);
  assert.equal(lead1.data.name, "محمد");
  assert.equal(lead1.data.score, 35);
  assert.equal(lead1.data.temperature, "cold");
  assert.deepEqual(lead1.data.custom_data, {
    location: "Riyadh",
    property_type: "apartment",
  });
  assert.equal("budget" in lead1.data, false); // no industry column

  const msgs1 = await db
    .from("messages")
    .select("role, content")
    .eq("conversation_id", t1.conversationId);
  assert.equal(msgs1.data.length, 2);

  const ev1 = await db
    .from("lead_events")
    .select("event_type, metadata")
    .eq("lead_id", t1.leadId);
  const types1 = ev1.data.map((e: { event_type: string }) => e.event_type).sort();
  assert.deepEqual(types1, ["lead_created", "message_received"]);

  // ── turn 2 (continue — score & temp change) ──
  const t2 = await persistChatTurn(db, {
    organizationId: orgId,
    conversationId: t1.conversationId,
    channel: "web",
    source: "chat",
    userMessage: "budget is 1 million, 4 bedrooms, financing, within a week",
    assistantMessage: "Perfect, all noted. A specialist will follow up.",
    lead: reLead,
    score: 100,
    temperature: "HOT",
  });

  assert.equal(t2.conversationId, t1.conversationId); // reused
  assert.equal(t2.leadId, t1.leadId); // same lead, no duplicate

  const leadRows = await db.from("leads").select("id").eq("organization_id", orgId);
  assert.equal(leadRows.data.length, 1);

  const lead2 = await db.from("leads").select("*").eq("id", t1.leadId).single();
  assert.equal(lead2.data.score, 100);
  assert.equal(lead2.data.temperature, "hot");
  assert.deepEqual(lead2.data.custom_data, reLead.customData);

  const msgs2 = await db.from("messages").select("id").eq("conversation_id", t1.conversationId);
  assert.equal(msgs2.data.length, 4); // 2 + 2, no per-chunk rows

  const ev2 = await db.from("lead_events").select("event_type, metadata").eq("lead_id", t1.leadId);
  const scoreEv = ev2.data.find((e: { event_type: string }) => e.event_type === "score_changed");
  const tempEv = ev2.data.find((e: { event_type: string }) => e.event_type === "temperature_changed");
  assert.deepEqual(scoreEv.metadata, { from: 35, to: 100 });
  assert.deepEqual(tempEv.metadata, { from: "cold", to: "hot" });

  // conversation last_message_at advanced
  const conv = await db
    .from("conversations")
    .select("started_at, last_message_at")
    .eq("id", t1.conversationId)
    .single();
  assert.ok(conv.data.last_message_at >= conv.data.started_at);
});

test("a clinic lead persists through the same code path", { skip }, async () => {
  const clinic = await db
    .from("organizations")
    .insert({ name: "IT Clinic", slug: `${SLUG}-c`, industry_template_id: "clinic" })
    .select("id")
    .single();
  try {
    const r = await persistChatTurn(db, {
      organizationId: clinic.data.id,
      conversationId: null,
      channel: "web",
      source: "chat",
      userMessage: "dental cleaning with Dr. Ahmed tomorrow, I have insurance, urgent",
      assistantMessage: "Noted, the clinic team will confirm.",
      lead: {
        name: "Ahmed",
        phone: "+966555555555",
        email: null,
        intent: null,
        customData: {
          service: "Dental Cleaning",
          doctor: "Dr. Ahmed",
          appointment_date: "tomorrow",
          insurance: true,
          urgency: "high",
        },
      },
      score: 100,
      temperature: "HOT",
    });
    const row = await db.from("leads").select("*").eq("id", r.leadId).single();
    assert.equal(row.data.name, "Ahmed");
    assert.equal(row.data.phone, "+966555555555");
    assert.equal(row.data.intent, null);
    assert.equal(row.data.custom_data.service, "Dental Cleaning");
    assert.equal(row.data.custom_data.urgency, "high");
    assert.equal("service" in row.data, false);
  } finally {
    await db.from("organizations").delete().eq("id", clinic.data.id);
  }
});

test("concurrent identical requests do not duplicate anything (real Postgres)", { skip }, async () => {
  const org = await db
    .from("organizations")
    .insert({ name: "IT Concurrency", slug: `${SLUG}-x`, industry_template_id: "real-estate" })
    .select("id")
    .single();
  const cOrgId = org.data.id;
  try {
    const turn = {
      organizationId: cOrgId,
      conversationId: null,
      requestId: crypto.randomUUID(),
      channel: "web",
      source: "chat",
      userMessage: "concurrency: 3 bed villa in Riyadh",
      assistantMessage: "Noted — what's your budget?",
      lead: {
        name: "Sara",
        phone: null,
        email: null,
        intent: "buy",
        customData: { location: "Riyadh", property_type: "villa", bedrooms: 3 },
      } as LeadData,
      score: 55,
      temperature: "WARM" as const,
    };

    // ── first turn: fire the same request 5× at once ──
    const results = await Promise.all(
      Array.from({ length: 5 }, () => persistChatTurn(db, turn)),
    );
    const convIds = new Set(results.map((r) => r.conversationId));
    const leadIds = new Set(results.map((r) => r.leadId));
    assert.equal(convIds.size, 1, "one conversation id");
    assert.equal(leadIds.size, 1, "one lead id");
    const convId = [...convIds][0];
    const leadId = [...leadIds][0];

    const leads = await db.from("leads").select("id").eq("organization_id", cOrgId);
    assert.equal(leads.data.length, 1, "exactly one lead row");
    const convs = await db.from("conversations").select("id").eq("organization_id", cOrgId);
    assert.equal(convs.data.length, 1, "exactly one conversation row");
    const msgs = await db.from("messages").select("role").eq("conversation_id", convId);
    assert.equal(msgs.data.length, 2, "exactly one user + one assistant message");
    const events = await db.from("lead_events").select("event_type").eq("lead_id", leadId);
    assert.deepEqual(
      events.data.map((e: { event_type: string }) => e.event_type).sort(),
      ["lead_created", "message_received"],
      "no duplicated events",
    );
    assert.equal(
      results.reduce((n, r) => n + r.messagesInserted, 0),
      2,
      "exactly one request did the message inserts",
    );

    // ── continuing turn: fire the same request 5× at once ──
    const turn2 = {
      ...turn,
      conversationId: convId,
      requestId: crypto.randomUUID(),
      userMessage: "budget 2 million, financing, next week",
      assistantMessage: "All set.",
      score: 100,
      temperature: "HOT" as const,
      lead: {
        ...turn.lead,
        customData: { ...turn.lead.customData, budget: 2_000_000, financing: true, timeline: "1 week" },
      },
    };
    await Promise.all(Array.from({ length: 5 }, () => persistChatTurn(db, turn2)));

    const leads2 = await db.from("leads").select("id, score").eq("organization_id", cOrgId);
    assert.equal(leads2.data.length, 1);
    assert.equal(leads2.data[0].score, 100);
    const msgs2 = await db.from("messages").select("id").eq("conversation_id", convId);
    assert.equal(msgs2.data.length, 4, "2 + 2, no duplicates from the concurrent burst");
    const events2 = await db
      .from("lead_events")
      .select("event_type")
      .eq("lead_id", leadId)
      .eq("request_id", turn2.requestId);
    assert.deepEqual(
      events2.data.map((e: { event_type: string }) => e.event_type).sort(),
      ["message_received", "score_changed", "temperature_changed"],
      "exactly one of each change event for the turn",
    );
  } finally {
    await db.from("organizations").delete().eq("id", cOrgId);
  }
});

// ── lead de-duplication (a widget visitor returning in a fresh browser) ────

function widgetTurn(orgId: string, lead: LeadData, extra: Record<string, unknown> = {}) {
  return {
    organizationId: orgId,
    conversationId: null,
    requestId: crypto.randomUUID(),
    channel: "web",
    source: "widget",
    userMessage: "hello",
    assistantMessage: "hi, how can I help?",
    lead,
    score: 20,
    temperature: "COLD" as const,
    ...extra,
  };
}

const blankLead = (over: Partial<LeadData>): LeadData => ({
  name: null,
  phone: null,
  email: null,
  intent: null,
  customData: {},
  ...over,
});

test("dedup: a returning visitor with the SAME email (any case) reuses their existing lead, in a NEW conversation", { skip }, async () => {
  const org = await db
    .from("organizations")
    .insert({ name: "IT Dedup Email", slug: `${SLUG}-dedup-email`, industry_template_id: "real-estate" })
    .select("id")
    .single();
  const dOrg = org.data.id;
  try {
    const t1 = await persistChatTurn(
      db,
      widgetTurn(dOrg, blankLead({ name: "Ali", email: "Ali@Example.com" })),
    );
    // A brand new browser session: no conversationId echoed, no requestId reuse.
    const t2 = await persistChatTurn(
      db,
      widgetTurn(dOrg, blankLead({ name: "Ali", email: "ali@example.com" })),
    );

    assert.notEqual(t2.conversationId, t1.conversationId, "a distinct conversation");
    assert.equal(t2.leadId, t1.leadId, "the SAME lead — no duplicate");
    assert.equal(t2.leadCreated, false);

    const leads = await db.from("leads").select("id").eq("organization_id", dOrg);
    assert.equal(leads.data.length, 1, "exactly one lead for this email");
    const convs = await db.from("conversations").select("id").eq("organization_id", dOrg);
    assert.equal(convs.data.length, 2, "two conversations, one lead");
  } finally {
    await db.from("organizations").delete().eq("id", dOrg);
  }
});

test("dedup: a Saudi number in ANY common format (+9665.., 009665.., 9665.., 05.., 5..) matches the same lead", { skip }, async () => {
  const org = await db
    .from("organizations")
    .insert({ name: "IT Dedup Phone", slug: `${SLUG}-dedup-phone`, industry_template_id: "real-estate" })
    .select("id")
    .single();
  const dOrg = org.data.id;
  try {
    const first = await persistChatTurn(
      db,
      widgetTurn(dOrg, blankLead({ name: "Sara", phone: "+966501234567" })),
    );

    const variants = ["00966501234567", "966501234567", "0501234567", "501234567"];
    for (const phone of variants) {
      const t = await persistChatTurn(db, widgetTurn(dOrg, blankLead({ name: "Sara", phone })));
      assert.equal(t.leadId, first.leadId, `phone "${phone}" must match the same lead`);
      assert.notEqual(t.conversationId, first.conversationId);
    }

    const leads = await db.from("leads").select("id, phone").eq("organization_id", dOrg);
    assert.equal(leads.data.length, 1, "every format collapsed onto one lead");
    // the stored phone is whatever the FIRST turn extracted — later turns update it
    assert.equal(leads.data[0].phone, variants[variants.length - 1]);
  } finally {
    await db.from("organizations").delete().eq("id", dOrg);
  }
});

test("dedup: DIFFERENT Saudi numbers (sharing no 9-digit tail) never merge", { skip }, async () => {
  const org = await db
    .from("organizations")
    .insert({ name: "IT Dedup Phone Distinct", slug: `${SLUG}-dedup-phone-2`, industry_template_id: "real-estate" })
    .select("id")
    .single();
  const dOrg = org.data.id;
  try {
    const a = await persistChatTurn(
      db,
      widgetTurn(dOrg, blankLead({ name: "Khalid", phone: "+966501111111" })),
    );
    const b = await persistChatTurn(
      db,
      widgetTurn(dOrg, blankLead({ name: "Nasser", phone: "+966502222222" })),
    );
    assert.notEqual(a.leadId, b.leadId);

    const leads = await db.from("leads").select("id").eq("organization_id", dOrg);
    assert.equal(leads.data.length, 2);
  } finally {
    await db.from("organizations").delete().eq("id", dOrg);
  }
});

test("dedup: no contact info yet → each anonymous session gets its OWN lead (never merged)", { skip }, async () => {
  const org = await db
    .from("organizations")
    .insert({ name: "IT Dedup None", slug: `${SLUG}-dedup-none`, industry_template_id: "real-estate" })
    .select("id")
    .single();
  const dOrg = org.data.id;
  try {
    const a = await persistChatTurn(db, widgetTurn(dOrg, blankLead({ name: "Visitor" })));
    const b = await persistChatTurn(db, widgetTurn(dOrg, blankLead({ name: "Visitor" })));
    assert.notEqual(a.leadId, b.leadId, "no phone/email → never dedup, even with the same name");

    const leads = await db.from("leads").select("id").eq("organization_id", dOrg);
    assert.equal(leads.data.length, 2);
  } finally {
    await db.from("organizations").delete().eq("id", dOrg);
  }
});

test("dedup: real concurrent DIFFERENT sessions with the SAME phone collapse to ONE lead (real Postgres)", { skip }, async () => {
  // The exact scenario the Enterprise Readiness load test found broken
  // (2026-09-12): 30 concurrent anonymous visitors sending one phone number
  // produced 224 leads instead of ~1. Each call here has its OWN requestId
  // (a genuinely different anonymous session), fired truly concurrently via
  // Promise.all against real Postgres — the `creation_request_id` unique
  // index cannot catch this; only `leads_org_phone_match_key_key`
  // (20260912090000_lead_contact_dedup.sql) can.
  const org = await db
    .from("organizations")
    .insert({ name: "IT Dedup Concurrent Phone", slug: `${SLUG}-dedup-concurrent-phone`, industry_template_id: "real-estate" })
    .select("id")
    .single();
  const dOrg = org.data.id;
  try {
    const sharedPhone = "+966501234567";
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        persistChatTurn(db, widgetTurn(dOrg, blankLead({ name: "Concurrent Caller", phone: sharedPhone }))),
      ),
    );

    const leads = await db.from("leads").select("id").eq("organization_id", dOrg);
    assert.equal(leads.data.length, 1, "10 concurrent sessions, same phone, must collapse to ONE lead");

    const leadIds = new Set(results.map((r: { leadId: string }) => r.leadId));
    assert.equal(leadIds.size, 1, "every concurrent caller agrees on the same lead id");

    const convs = await db.from("conversations").select("id").eq("organization_id", dOrg);
    assert.equal(convs.data.length, 10, "10 distinct anonymous sessions, still one lead");
  } finally {
    await db.from("organizations").delete().eq("id", dOrg);
  }
});

test("dedup: real concurrent DIFFERENT sessions with the SAME email collapse to ONE lead (real Postgres)", { skip }, async () => {
  const org = await db
    .from("organizations")
    .insert({ name: "IT Dedup Concurrent Email", slug: `${SLUG}-dedup-concurrent-email`, industry_template_id: "clinic" })
    .select("id")
    .single();
  const dOrg = org.data.id;
  try {
    const sharedEmail = "concurrent-it@example.test";
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        persistChatTurn(db, widgetTurn(dOrg, blankLead({ name: "Concurrent Caller", email: sharedEmail }))),
      ),
    );

    const leads = await db.from("leads").select("id").eq("organization_id", dOrg);
    assert.equal(leads.data.length, 1);
    assert.equal(new Set(results.map((r: { leadId: string }) => r.leadId)).size, 1);
  } finally {
    await db.from("organizations").delete().eq("id", dOrg);
  }
});

test("dedup NEVER crosses organizations — the same email in org B creates its OWN lead", { skip }, async () => {
  const a = await db
    .from("organizations")
    .insert({ name: "IT Dedup Cross A", slug: `${SLUG}-dedup-x-a`, industry_template_id: "real-estate" })
    .select("id")
    .single();
  const b = await db
    .from("organizations")
    .insert({ name: "IT Dedup Cross B", slug: `${SLUG}-dedup-x-b`, industry_template_id: "clinic" })
    .select("id")
    .single();
  const orgA = a.data.id;
  const orgB = b.data.id;
  try {
    const inA = await persistChatTurn(
      db,
      widgetTurn(orgA, blankLead({ name: "Shared", email: "shared@example.test" })),
    );
    const inB = await persistChatTurn(
      db,
      widgetTurn(orgB, blankLead({ name: "Shared", email: "shared@example.test" })),
    );
    assert.notEqual(inA.leadId, inB.leadId, "org B never merges into org A's lead");

    const leadsA = await db.from("leads").select("id").eq("organization_id", orgA);
    const leadsB = await db.from("leads").select("id").eq("organization_id", orgB);
    assert.equal(leadsA.data.length, 1);
    assert.equal(leadsB.data.length, 1);
  } finally {
    await db.from("organizations").delete().eq("id", orgA);
    await db.from("organizations").delete().eq("id", orgB);
  }
});
