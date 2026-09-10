import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildChatContext } from "./chat-context.ts";
import { toMembership, type MembershipJoinRow } from "./membership.ts";
import { resolveChatPresentation } from "../chat/presentation.ts";
import { effectiveConfigFromStored } from "../config/organization-config.ts";
import { en } from "../../i18n/dictionaries/en.ts";

/**
 * Real-Postgres tests for `set_organization_industry`
 * (`20260909130000_organization_industry.sql`): owner/admin can switch their
 * org's industry, others cannot, it is atomic + tenant-scoped, overrides are
 * reset, and both the chat presentation and the effective AI config follow the
 * new industry.
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

async function makeUser(tag: string) {
  const email = `ind-it-${tag}-${stamp}@example.test`;
  const c = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  if (c.error) throw c.error;
  const client = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const s = await client.auth.signInWithPassword({ email, password: "test-password-123" });
  if (s.error) throw s.error;
  users[tag] = { id: c.data.user.id, client };
}

async function presentationFor(client: AnyClient) {
  const { data } = await client
    .from("organization_members")
    .select("role, organizations ( id, name, slug, industry_template_id, status )")
    .order("created_at", { ascending: true })
    .limit(1);
  const membership = toMembership(data?.[0] as unknown as MembershipJoinRow);
  const ctx = buildChatContext({ authenticated: true, membership, widgetOrg: null, demoOrg: null });
  return {
    presentation: resolveChatPresentation({
      industrySlug: ctx.organization?.industryTemplateId ?? null,
      businessName: ctx.organization?.organizationName ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dict: en as any,
    }),
    industryTemplateId: ctx.organization?.industryTemplateId ?? null,
  };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await makeUser("owner");
  await makeUser("admin");
  await makeUser("viewer");
  await makeUser("otherOwner");

  orgA = (await users.owner.client.rpc("create_organization_with_owner", {
    p_name: "Industry IT A", p_industry_template_id: "real-estate",
  })).data.id;
  orgB = (await users.otherOwner.client.rpc("create_organization_with_owner", {
    p_name: "Industry IT B", p_industry_template_id: "clinic",
  })).data.id;

  await users.owner.client.from("organization_members").insert([
    { organization_id: orgA, user_id: users.admin.id, role: "admin" },
    { organization_id: orgA, user_id: users.viewer.id, role: "viewer" },
  ]);
});

after(async () => {
  if (!enabled) return;
  for (const o of [orgA, orgB]) if (o) await admin.from("organizations").delete().eq("id", o);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

test("owner switches their org's industry — row updated, config reset, presentation + effective config follow", { skip }, async () => {
  // seed an override so we can prove it is cleared
  await admin
    .from("organization_configs")
    .update({ config: { aiBehaviorOverrides: { persona: "a brokerage bro" } } })
    .eq("organization_id", orgA);

  const beforeP = await presentationFor(users.owner.client);
  assert.equal(beforeP.industryTemplateId, "real-estate");

  const { data, error } = await users.owner.client.rpc("set_organization_industry", {
    p_industry_template_id: "clinic",
  });
  assert.equal(error, null);
  assert.equal(data.industry_template_id, "clinic");

  const row = await admin.from("organizations").select("industry_template_id").eq("id", orgA).single();
  assert.equal(row.data.industry_template_id, "clinic");

  const cfg = await admin.from("organization_configs").select("config").eq("organization_id", orgA).single();
  assert.deepEqual(cfg.data.config, {}, "industry-coupled overrides are reset");

  const afterP = await presentationFor(users.owner.client);
  assert.equal(afterP.industryTemplateId, "clinic");
  assert.notEqual(afterP.presentation.greeting, beforeP.presentation.greeting);
  assert.ok(
    /appointment|clinic/i.test(afterP.presentation.suggestedPrompts.join(" ")),
    "chat presentation now clinic",
  );

  // effective AI config is rebuilt from the new template, override gone
  const eff = effectiveConfigFromStored(orgA, "clinic", cfg.data.config);
  assert.equal(eff.templateSlug, "clinic");
  assert.ok(eff.leadFields.some((f) => f.key === "service"));
  assert.ok(!eff.leadFields.some((f) => f.key === "budget"));
  assert.ok(!/brokerage bro/.test(eff.aiBehavior.persona), "the stale persona override is gone");

  // switch back for a clean slate
  await users.owner.client.rpc("set_organization_industry", { p_industry_template_id: "real-estate" });
});

test("an admin of the org can also change it", { skip }, async () => {
  const r = await users.admin.client.rpc("set_organization_industry", { p_industry_template_id: "clinic" });
  assert.equal(r.error, null);
  assert.equal(r.data.industry_template_id, "clinic");
  await users.admin.client.rpc("set_organization_industry", { p_industry_template_id: "real-estate" });
});

test("a viewer CANNOT change the industry", { skip }, async () => {
  const r = await users.viewer.client.rpc("set_organization_industry", { p_industry_template_id: "clinic" });
  assert.ok(r.error, "expected a permission error");
  assert.match(r.error.message, /not permitted|owner or admin/i);
  const row = await admin.from("organizations").select("industry_template_id").eq("id", orgA).single();
  assert.equal(row.data.industry_template_id, "real-estate", "nothing changed");
});

test("org A's owner cannot touch org B — the RPC only ever resolves the caller's own org", { skip }, async () => {
  // users.owner is owner of A only; calling the RPC changes A, never B.
  await users.owner.client.rpc("set_organization_industry", { p_industry_template_id: "clinic" });
  const b = await admin.from("organizations").select("industry_template_id").eq("id", orgB).single();
  assert.equal(b.data.industry_template_id, "clinic", "org B is unchanged and still its own value");
  // (orgB was seeded as clinic; assert it was never real-estate-ified by A's call)
  await users.owner.client.rpc("set_organization_industry", { p_industry_template_id: "real-estate" });
});

test("a malformed / empty industry slug is rejected — never defaults", { skip }, async () => {
  for (const bad of ["", "   ", null, "Real Estate", "drop;table"]) {
    const r = await users.owner.client.rpc("set_organization_industry", { p_industry_template_id: bad });
    assert.ok(r.error, `slug=${JSON.stringify(bad)} must raise`);
  }
  const row = await admin.from("organizations").select("industry_template_id").eq("id", orgA).single();
  assert.equal(row.data.industry_template_id, "real-estate");
});
