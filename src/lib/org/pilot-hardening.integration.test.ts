import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  acceptInvitation,
  createInvitation,
  getInvitationByToken,
} from "./invitations.server.ts";
import { resolveOrgByWidgetKey } from "./widget.ts";

/**
 * Real-Postgres tests for the pilot-hardening migration
 * (`20260905200000_pilot_hardening.sql`): the `hit_rate_limit` RPC, team
 * invitation RLS + privilege-escalation guard + acceptance flow, and
 * per-organization widget settings RLS + anonymous key resolution. Every
 * client query runs through a user JWT (RLS enforced) unless it explicitly
 * needs the service role. Same shape as `leads/recovery.integration.test.ts`.
 * Skipped unless `LEADFLOW_DB_TEST_URL` + `_SERVICE_KEY` + a DISTINCT `_ANON_KEY`.
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
const users: Record<string, { id: string; email: string; client: AnyClient }> = {};
let orgA = "";
let orgB = "";

async function makeUser(tag: string) {
  const email = `pilot-it-${tag}-${stamp}@example.test`;
  const password = "test-password-123";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  users[tag] = { id: created.data.user.id, email, client };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await makeUser("a"); // owner of A
  await makeUser("b"); // owner of B
  await makeUser("c"); // viewer in A
  await makeUser("invitee"); // unattached — will accept an invite into A
  await makeUser("invitee2"); // unattached — used for wrong-email + another-org cases

  const a = await users.a.client.rpc("create_organization_with_owner", {
    p_name: "Pilot IT Org A",
    p_industry_template_id: "real-estate",
  });
  if (a.error) throw a.error;
  orgA = a.data.id;

  const b = await users.b.client.rpc("create_organization_with_owner", {
    p_name: "Pilot IT Org B",
    p_industry_template_id: "clinic",
  });
  if (b.error) throw b.error;
  orgB = b.data.id;

  const addC = await users.a.client
    .from("organization_members")
    .insert({ organization_id: orgA, user_id: users.c.id, role: "viewer" });
  if (addC.error) throw addC.error;
});

after(async () => {
  if (!enabled) return;
  for (const org of [orgA, orgB]) {
    if (org) await admin.from("organizations").delete().eq("id", org);
  }
  for (const u of Object.values(users)) {
    await admin.auth.admin.deleteUser(u.id);
  }
  // `private.rate_limits` rows keyed `pilot-it-<stamp>:*` are tiny and orphan-
  // harmless (the `private` schema isn't PostgREST-reachable to clean here).
});

// ── Rate limiting ────────────────────────────────────────────────────────

test("hit_rate_limit allows exactly p_max hits per window then blocks", { skip }, async () => {
  const key = `pilot-it-${stamp}:rl-basic`;
  const outcomes: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    const { data, error } = await admin.rpc("hit_rate_limit", {
      p_key: key,
      p_max: 3,
      p_window_seconds: 60,
    });
    assert.equal(error, null);
    outcomes.push(data);
  }
  assert.deepEqual(outcomes, [true, true, true, false, false]);
});

test("hit_rate_limit resets after the window elapses", { skip }, async () => {
  const key = `pilot-it-${stamp}:rl-reset`;
  const first = await admin.rpc("hit_rate_limit", { p_key: key, p_max: 1, p_window_seconds: 1 });
  assert.equal(first.data, true);
  const second = await admin.rpc("hit_rate_limit", { p_key: key, p_max: 1, p_window_seconds: 1 });
  assert.equal(second.data, false);
  await new Promise((r) => setTimeout(r, 1100));
  const third = await admin.rpc("hit_rate_limit", { p_key: key, p_max: 1, p_window_seconds: 1 });
  assert.equal(third.data, true, "window should have rolled over");
});

test("hit_rate_limit is not callable by an anon or authenticated client", { skip }, async () => {
  const anon = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonCall = await anon.rpc("hit_rate_limit", { p_key: "x", p_max: 1, p_window_seconds: 60 });
  assert.ok(anonCall.error, "anon must be denied");

  const authedCall = await users.a.client.rpc("hit_rate_limit", {
    p_key: "x",
    p_max: 1,
    p_window_seconds: 60,
  });
  assert.ok(authedCall.error, "authenticated must be denied");
});

// ── Team invitations ────────────────────────────────────────────────────

test("owner/admin can create an invite; viewer cannot; owner role is refused by the CHECK", { skip }, async () => {
  const ok = await createInvitation(users.a.client, {
    organizationId: orgA,
    email: users.invitee.email,
    role: "sales",
    invitedBy: users.a.id,
  });
  assert.equal(ok.status, "created");

  const viewerAttempt = await users.c.client.from("organization_invitations").insert({
    organization_id: orgA,
    email: "someone@example.test",
    role: "viewer",
    token_hash: `hash-${stamp}-viewer`,
    invited_by: users.c.id,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.ok(viewerAttempt.error, "viewer must not be able to create invites");

  const ownerRole = await users.a.client.from("organization_invitations").insert({
    organization_id: orgA,
    email: "escalate@example.test",
    role: "owner",
    token_hash: `hash-${stamp}-owner`,
    invited_by: users.a.id,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.ok(ownerRole.error, "the CHECK (role <> 'owner') must reject an owner invite");
});

test("an admin of org B cannot create an invite into org A (cross-tenant)", { skip }, async () => {
  const crossOrg = await users.b.client.from("organization_invitations").insert({
    organization_id: orgA,
    email: "b-into-a@example.test",
    role: "admin",
    token_hash: `hash-${stamp}-cross`,
    invited_by: users.b.id,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.ok(crossOrg.error, "org B must not write invites into org A");
});

test("a duplicate pending invite for the same (org, email) is rejected", { skip }, async () => {
  const dup = await createInvitation(users.a.client, {
    organizationId: orgA,
    email: users.invitee.email.toUpperCase(), // case-insensitive unique index
    role: "manager",
    invitedBy: users.a.id,
  });
  assert.equal(dup.status, "already_pending");
});

test("org B's owner cannot read org A's invitations", { skip }, async () => {
  const view = await users.b.client
    .from("organization_invitations")
    .select("id")
    .eq("organization_id", orgA);
  assert.deepEqual(view.data, []);
});

test("even the invitee's own session cannot mark an invite accepted (no UPDATE policy)", { skip }, async () => {
  const pending = await admin
    .from("organization_invitations")
    .select("id")
    .eq("organization_id", orgA)
    .is("accepted_at", null)
    .limit(1)
    .single();
  assert.equal(pending.error, null);

  const selfAccept = await users.invitee.client
    .from("organization_invitations")
    .update({ accepted_at: new Date().toISOString(), accepted_by: users.invitee.id })
    .eq("id", pending.data.id)
    .select("id");
  // RLS: no UPDATE policy for `authenticated` → zero rows affected, no error.
  assert.deepEqual(selfAccept.data ?? [], []);
});

test("acceptInvitation adds the invitee as a member with the invited role, single-use", { skip }, async () => {
  const created = await createInvitation(users.a.client, {
    organizationId: orgA,
    email: users.invitee2.email,
    role: "manager",
    invitedBy: users.a.id,
  });
  assert.equal(created.status, "created");
  const rawToken = created.status === "created" ? created.rawToken : "";

  // Wrong user email is refused.
  const wrong = await acceptInvitation(admin, rawToken, {
    id: users.invitee.id,
    email: users.invitee.email,
  });
  assert.equal(wrong.status, "wrong_email");

  // Correct invitee accepts.
  const accepted = await acceptInvitation(admin, rawToken, {
    id: users.invitee2.id,
    email: users.invitee2.email,
  });
  assert.equal(accepted.status, "accepted");

  const membership = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgA)
    .eq("user_id", users.invitee2.id)
    .single();
  assert.equal(membership.error, null);
  assert.equal(membership.data.role, "manager");

  // Token is single-use — a replay reports already-member, not a second join.
  const replay = await acceptInvitation(admin, rawToken, {
    id: users.invitee2.id,
    email: users.invitee2.email,
  });
  assert.equal(replay.status, "already_member");

  // The invitee2 user, now in org A, cannot accept an invite into org B.
  const bInvite = await createInvitation(users.b.client, {
    organizationId: orgB,
    email: users.invitee2.email,
    role: "sales",
    invitedBy: users.b.id,
  });
  assert.equal(bInvite.status, "created");
  const bToken = bInvite.status === "created" ? bInvite.rawToken : "";
  const another = await acceptInvitation(admin, bToken, {
    id: users.invitee2.id,
    email: users.invitee2.email,
  });
  assert.equal(another.status, "in_another_org");
});

test("getInvitationByToken returns null for an unknown token", { skip }, async () => {
  const missing = await getInvitationByToken(admin, "x".repeat(43));
  assert.equal(missing, null);
});

// ── Widget settings ─────────────────────────────────────────────────────

test("a member reads widget settings; a viewer cannot create/rotate them", { skip }, async () => {
  const created = await users.a.client
    .from("organization_widget_settings")
    .insert({ organization_id: orgA })
    .select("widget_key, enabled")
    .single();
  assert.equal(created.error, null);
  assert.equal(created.data.enabled, false, "widget is disabled by default");

  const viewerRead = await users.c.client
    .from("organization_widget_settings")
    .select("widget_key")
    .eq("organization_id", orgA);
  assert.equal(viewerRead.error, null);
  assert.equal(viewerRead.data.length, 1);

  const viewerWrite = await users.c.client
    .from("organization_widget_settings")
    .update({ enabled: true })
    .eq("organization_id", orgA)
    .select("organization_id");
  assert.deepEqual(viewerWrite.data ?? [], [], "viewer update must affect no rows");
});

test("org B cannot see or touch org A's widget settings", { skip }, async () => {
  const view = await users.b.client
    .from("organization_widget_settings")
    .select("organization_id")
    .eq("organization_id", orgA);
  assert.deepEqual(view.data, []);

  const write = await users.b.client
    .from("organization_widget_settings")
    .update({ enabled: true })
    .eq("organization_id", orgA)
    .select("organization_id");
  assert.deepEqual(write.data ?? [], []);
});

test("resolveOrgByWidgetKey: null while disabled, resolves to the right org once enabled", { skip }, async () => {
  const row = await admin
    .from("organization_widget_settings")
    .select("widget_key")
    .eq("organization_id", orgA)
    .single();
  assert.equal(row.error, null);
  const key = row.data.widget_key as string;

  // Disabled → no resolution (the widget hasn't been turned on).
  assert.equal(await resolveOrgByWidgetKey(admin, key), null);

  // Unknown key → null.
  assert.equal(
    await resolveOrgByWidgetKey(admin, "00000000-0000-4000-8000-000000000000"),
    null,
  );
  // Non-UUID → null.
  assert.equal(await resolveOrgByWidgetKey(admin, "not-a-uuid"), null);

  const enable = await users.a.client
    .from("organization_widget_settings")
    .update({ enabled: true })
    .eq("organization_id", orgA);
  assert.equal(enable.error, null);

  const resolved = await resolveOrgByWidgetKey(admin, key);
  assert.deepEqual(resolved, { organizationId: orgA, industryTemplateId: "real-estate" });
});

test("a suspended organization's widget key stops resolving", { skip }, async () => {
  const row = await admin
    .from("organization_widget_settings")
    .select("widget_key")
    .eq("organization_id", orgA)
    .single();
  const key = row.data.widget_key as string;

  await admin.from("organizations").update({ status: "suspended" }).eq("id", orgA);
  assert.equal(await resolveOrgByWidgetKey(admin, key), null);
  await admin.from("organizations").update({ status: "active" }).eq("id", orgA);
});
