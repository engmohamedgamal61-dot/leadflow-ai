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
