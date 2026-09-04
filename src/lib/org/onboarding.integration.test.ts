import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

/**
 * Real-Postgres auth + onboarding + tenant-isolation tests. Skipped unless
 * `LEADFLOW_DB_TEST_URL` + `LEADFLOW_DB_TEST_SERVICE_KEY` (+ optional
 * `LEADFLOW_DB_TEST_ANON_KEY`) are set — point them at a local `supabase start`
 * instance, never a production project.
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
// A DISTINCT anon key is required — these tests assert RLS behaviour, which a
// service-role client would silently bypass.
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const enabled = Boolean(URL && SERVICE_KEY && ANON_KEY && ANON_KEY !== SERVICE_KEY);
const skip = enabled
  ? false
  : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY + LEADFLOW_DB_TEST_ANON_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const stamp = Date.now();
let admin: AnyClient;
const users: { id: string; email: string; client: AnyClient }[] = [];

async function makeUser(tag: string): Promise<{ id: string; email: string; client: AnyClient }> {
  const email = `it-${tag}-${stamp}@example.test`;
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
  return { id: created.data.user.id, email, client };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  users.push(await makeUser("a"));
  users.push(await makeUser("b"));
  users.push(await makeUser("c")); // never onboards
});

after(async () => {
  if (!enabled) return;
  for (const u of users) {
    // cascades to memberships / configs / orgs the user owns via FK on delete
    const membership = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", u.id);
    for (const m of membership.data ?? []) {
      await admin.from("organizations").delete().eq("id", m.organization_id);
    }
    await admin.auth.admin.deleteUser(u.id);
  }
});

test("onboarding creates org + owner membership + empty config atomically", { skip }, async () => {
  const [a] = users;
  const { data: org, error } = await a.client.rpc("create_organization_with_owner", {
    p_name: "Acme Realty",
    p_industry_template_id: "real-estate",
  });
  assert.equal(error, null);
  assert.ok(org?.id);
  assert.equal(org.industry_template_id, "real-estate");
  assert.equal(org.status, "active");

  const members = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", org.id);
  assert.equal(members.data.length, 1);
  assert.equal(members.data[0].user_id, a.id);
  assert.equal(members.data[0].role, "owner");

  const configs = await admin
    .from("organization_configs")
    .select("config")
    .eq("organization_id", org.id);
  assert.equal(configs.data.length, 1);
  assert.deepEqual(configs.data[0].config, {}); // overrides only, initially empty
});

test("industry template selection is honoured (clinic)", { skip }, async () => {
  const [, b] = users;
  const { data: org, error } = await b.client.rpc("create_organization_with_owner", {
    p_name: "Bright Smile Clinic",
    p_industry_template_id: "clinic",
  });
  assert.equal(error, null);
  assert.equal(org.industry_template_id, "clinic");
});

test("a second onboarding for the same user is rejected — no duplicate org", { skip }, async () => {
  const [a] = users;
  const before = await admin.from("organization_members").select("id").eq("user_id", a.id);
  const { error } = await a.client.rpc("create_organization_with_owner", {
    p_name: "Acme Realty Two",
    p_industry_template_id: "real-estate",
  });
  assert.ok(error, "expected an error");
  assert.match(error.message, /already belongs/i);
  const after = await admin.from("organization_members").select("id").eq("user_id", a.id);
  assert.equal(after.data.length, before.data.length);
});

test("existing-membership detection: a fresh user has no organization", { skip }, async () => {
  const [, , c] = users;
  const rows = await c.client
    .from("organization_members")
    .select("role, organizations ( id, status )")
    .eq("user_id", c.id);
  assert.equal(rows.error, null);
  assert.equal(rows.data.length, 0);
});

test("tenant isolation: user A cannot see or touch org B's data", { skip }, async () => {
  const [a] = users;
  const orgA = (await admin.from("organizations").select("id").eq("industry_template_id", "real-estate").eq("name", "Acme Realty")).data[0];
  const orgB = (await admin.from("organizations").select("id").eq("name", "Bright Smile Clinic")).data[0];

  // A's own org is visible; B's is not.
  const visible = await a.client.from("organizations").select("id");
  const ids = visible.data.map((r: { id: string }) => r.id);
  assert.ok(ids.includes(orgA.id));
  assert.equal(ids.includes(orgB.id), false);

  // Explicitly selecting B's org by id returns nothing.
  const probe = await a.client.from("organizations").select("id").eq("id", orgB.id);
  assert.deepEqual(probe.data, []);

  // A cannot insert a lead into B's org (RLS write check).
  const inject = await a.client.from("leads").insert({ organization_id: orgB.id, name: "x" }).select("id");
  assert.ok(inject.error, "RLS should block a cross-tenant lead insert");

  // A cannot read B's members / configs.
  const bMembers = await a.client.from("organization_members").select("id").eq("organization_id", orgB.id);
  assert.deepEqual(bMembers.data, []);
});

test("a normal member cannot escalate their own role", { skip }, async () => {
  const [a] = users;
  const mine = (await a.client.from("organization_members").select("id, role").eq("user_id", a.id)).data[0];
  assert.equal(mine.role, "owner");
  // downgrade-then-check is enough to prove the self-update policy blocks it:
  const attempt = await a.client
    .from("organization_members")
    .update({ role: "viewer" })
    .eq("id", mine.id)
    .select("id");
  // policy `user_id <> auth.uid()` → 0 rows affected (or an error); either way,
  // the role must be unchanged.
  assert.ok(attempt.error || (attempt.data ?? []).length === 0);
  const after = (await admin.from("organization_members").select("role").eq("id", mine.id)).data[0];
  assert.equal(after.role, "owner");
});

test("demo behaviour is isolated to the unauthenticated path", { skip }, async () => {
  const [a] = users;
  // The seeded demo orgs are invisible to an authenticated non-member.
  const demo = await a.client.from("organizations").select("slug").in("slug", ["demo-real-estate", "demo-clinic"]);
  assert.deepEqual(demo.data, []);

  // Anonymous callers cannot invoke the onboarding RPC at all.
  const anon = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await anon.rpc("create_organization_with_owner", {
    p_name: "Anon Co",
    p_industry_template_id: "real-estate",
  });
  assert.ok(error, "anon must not be able to create an organization");
});
