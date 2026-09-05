import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

/**
 * Real-Postgres tests for `lead_recovery_attempts` (Phase L): tenant
 * isolation, the duplicate-attempt guard (the unique-open-per-lead index),
 * and role-based writes. Every query runs through a user-JWT client (RLS
 * enforced), following the exact pattern established in
 * `queries.integration.test.ts`. Skipped unless `LEADFLOW_DB_TEST_URL` +
 * `_SERVICE_KEY` + a DISTINCT `_ANON_KEY`.
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
let aLeadId = "";
let aFollowUpId = "";
let bLeadId = "";
let bFollowUpId = "";

async function makeUser(tag: string) {
  const email = `recovery-it-${tag}-${stamp}@example.test`;
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

async function newFollowUp(org: string, lead: string) {
  const row = await admin
    .from("lead_follow_ups")
    .insert({
      organization_id: org,
      lead_id: lead,
      scheduled_at: new Date().toISOString(),
      status: "pending",
      source: "recovery",
      channel: "internal",
      note: "recovery outreach",
    })
    .select("id")
    .single();
  if (row.error) throw row.error;
  return row.data.id as string;
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
    p_name: "Recovery IT Org A",
    p_industry_template_id: "real-estate",
  });
  if (a.error) throw a.error;
  orgA = a.data.id;

  const b = await users.b.client.rpc("create_organization_with_owner", {
    p_name: "Recovery IT Org B",
    p_industry_template_id: "clinic",
  });
  if (b.error) throw b.error;
  orgB = b.data.id;

  const addC = await users.a.client
    .from("organization_members")
    .insert({ organization_id: orgA, user_id: users.c.id, role: "viewer" });
  if (addC.error) throw addC.error;
  const addD = await users.a.client
    .from("organization_members")
    .insert({ organization_id: orgA, user_id: users.d.id, role: "sales" });
  if (addD.error) throw addD.error;

  const aLead = await admin
    .from("leads")
    .insert({
      organization_id: orgA,
      name: "Lost RE Lead",
      phone: "+966500000001",
      score: 80,
      temperature: "hot",
      status: "lost",
    })
    .select("id")
    .single();
  if (aLead.error) throw aLead.error;
  aLeadId = aLead.data.id;
  aFollowUpId = await newFollowUp(orgA, aLeadId);

  const bLead = await admin
    .from("leads")
    .insert({
      organization_id: orgB,
      name: "Lost Clinic Lead",
      phone: "+966500000002",
      score: 80,
      temperature: "hot",
      status: "lost",
    })
    .select("id")
    .single();
  if (bLead.error) throw bLead.error;
  bLeadId = bLead.data.id;
  bFollowUpId = await newFollowUp(orgB, bLeadId);
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

test("sales member (a write role) can start a recovery attempt", { skip }, async () => {
  const insert = await users.d.client
    .from("lead_recovery_attempts")
    .insert({
      organization_id: orgA,
      lead_id: aLeadId,
      follow_up_id: aFollowUpId,
      reason_key: "recovery.reasons.lostHot",
      priority: "high",
    })
    .select("id");
  assert.equal(insert.error, null);
  assert.equal(insert.data.length, 1);
});

test("a second OPEN attempt on the same lead is rejected by the unique index", { skip }, async () => {
  const followUp2 = await newFollowUp(orgA, aLeadId);
  const dup = await users.a.client.from("lead_recovery_attempts").insert({
    organization_id: orgA,
    lead_id: aLeadId,
    follow_up_id: followUp2,
    reason_key: "recovery.reasons.lostHot",
    priority: "high",
  });
  assert.ok(dup.error, "expected a unique-violation error");
  assert.equal(dup.error.code, "23505");
});

test("resolving the open attempt frees the lead for a new one", { skip }, async () => {
  const existing = await admin
    .from("lead_recovery_attempts")
    .select("id")
    .eq("lead_id", aLeadId)
    .is("resolved_at", null)
    .single();
  assert.equal(existing.error, null);

  const resolve = await users.a.client
    .from("lead_recovery_attempts")
    .update({ resolved_as: "no_response", resolved_at: new Date().toISOString() })
    .eq("organization_id", orgA)
    .eq("id", existing.data.id)
    .select("id");
  assert.equal(resolve.error, null);
  assert.equal(resolve.data.length, 1);

  const followUp3 = await newFollowUp(orgA, aLeadId);
  const secondAttempt = await users.a.client.from("lead_recovery_attempts").insert({
    organization_id: orgA,
    lead_id: aLeadId,
    follow_up_id: followUp3,
    reason_key: "recovery.reasons.lostHot",
    priority: "high",
  });
  assert.equal(secondAttempt.error, null);
});

test("cross-tenant read of recovery attempts is denied", { skip }, async () => {
  const bAttempt = await users.b.client.from("lead_recovery_attempts").insert({
    organization_id: orgB,
    lead_id: bLeadId,
    follow_up_id: bFollowUpId,
    reason_key: "recovery.reasons.lostHot",
    priority: "high",
  });
  assert.equal(bAttempt.error, null);

  // Org A's client sees only its own attempts, never org B's.
  const aView = await users.a.client.from("lead_recovery_attempts").select("organization_id");
  assert.ok(aView.data.every((r: { organization_id: string }) => r.organization_id === orgA));

  // A direct probe by id from org A's client for org B's row returns nothing.
  const probe = await users.a.client
    .from("lead_recovery_attempts")
    .select("id")
    .eq("lead_id", bLeadId);
  assert.deepEqual(probe.data, []);
});

test("a writer in org B cannot insert a recovery attempt against an org A lead/follow-up", { skip }, async () => {
  const followUp4 = await newFollowUp(orgA, aLeadId);
  const crossOrg = await users.b.client.from("lead_recovery_attempts").insert({
    organization_id: orgA,
    lead_id: aLeadId,
    follow_up_id: followUp4,
    reason_key: "recovery.reasons.lostHot",
    priority: "high",
  });
  assert.ok(crossOrg.error, "org B must not be able to write into org A");
});

test("viewer can read but cannot insert a recovery attempt", { skip }, async () => {
  const readable = await users.c.client.from("lead_recovery_attempts").select("id").eq("organization_id", orgA);
  assert.equal(readable.error, null);

  const followUp5 = await newFollowUp(orgA, aLeadId);
  const write = await users.c.client.from("lead_recovery_attempts").insert({
    organization_id: orgA,
    lead_id: aLeadId,
    follow_up_id: followUp5,
    reason_key: "recovery.reasons.lostHot",
    priority: "high",
  });
  assert.ok(write.error, "viewer insert must be blocked");
});

test("real estate and clinic organizations use the identical table/constraints (no industry branching)", { skip }, async () => {
  // Org B (clinic) already has an open attempt from the cross-tenant test —
  // a second open attempt on the same lead must be rejected exactly like org A's.
  const followUp6 = await newFollowUp(orgB, bLeadId);
  const dup = await users.b.client.from("lead_recovery_attempts").insert({
    organization_id: orgB,
    lead_id: bLeadId,
    follow_up_id: followUp6,
    reason_key: "recovery.reasons.lostHot",
    priority: "high",
  });
  assert.ok(dup.error);
  assert.equal(dup.error.code, "23505");
});

// Regression: a delivery that never actually happened (e.g. WhatsApp not
// connected) must resolve as 'failed', not 'no_response' — and the DB must
// accept that value (it originally only allowed converted/no_response).
test("resolving an attempt as 'failed' (delivery never happened) is accepted and frees the lead", { skip }, async () => {
  const open = await admin
    .from("lead_recovery_attempts")
    .select("id")
    .eq("lead_id", aLeadId)
    .is("resolved_at", null)
    .single();
  assert.equal(open.error, null);

  const resolveFailed = await users.a.client
    .from("lead_recovery_attempts")
    .update({ resolved_as: "failed", resolved_at: new Date().toISOString() })
    .eq("organization_id", orgA)
    .eq("id", open.data.id)
    .select("id");
  assert.equal(resolveFailed.error, null);
  assert.equal(resolveFailed.data.length, 1);

  // Freed up: a brand new attempt on the same lead now succeeds.
  const followUp7 = await newFollowUp(orgA, aLeadId);
  const fresh = await users.a.client.from("lead_recovery_attempts").insert({
    organization_id: orgA,
    lead_id: aLeadId,
    follow_up_id: followUp7,
    reason_key: "recovery.reasons.lostHot",
    priority: "high",
  });
  assert.equal(fresh.error, null);
});

test("resolved_as still rejects values outside converted/no_response/failed", { skip }, async () => {
  // aLeadId currently has an open attempt (from the previous test) — insert
  // against a fresh lead instead so this fails on the CHECK, not the unique index.
  const otherLead = await admin
    .from("leads")
    .insert({ organization_id: orgA, name: "Bogus Resolution Lead", status: "lost", temperature: "warm" })
    .select("id")
    .single();
  assert.equal(otherLead.error, null);
  const followUpForOther = await newFollowUp(orgA, otherLead.data.id);
  const attempt = await admin
    .from("lead_recovery_attempts")
    .insert({
      organization_id: orgA,
      lead_id: otherLead.data.id,
      follow_up_id: followUpForOther,
      reason_key: "recovery.reasons.lostGeneral",
      priority: "medium",
    })
    .select("id")
    .single();
  assert.equal(attempt.error, null);

  const bogus = await users.a.client
    .from("lead_recovery_attempts")
    .update({ resolved_as: "bogus_value", resolved_at: new Date().toISOString() })
    .eq("organization_id", orgA)
    .eq("id", attempt.data.id);
  assert.ok(bogus.error, "expected a check-constraint violation");
});
