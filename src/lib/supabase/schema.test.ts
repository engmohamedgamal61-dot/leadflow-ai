import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function sql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

const TENANT_TABLES = [
  "organizations",
  "organization_members",
  "organization_configs",
  "leads",
  "conversations",
  "messages",
  "lead_events",
];

test("all seven tenant tables are created", () => {
  const migration = sql();
  for (const table of TENANT_TABLES) {
    assert.match(
      migration,
      new RegExp(`create table public\\.${table}\\b`),
      `missing table ${table}`,
    );
  }
});

test("row level security is enabled on every tenant table", () => {
  const migration = sql();
  for (const table of TENANT_TABLES) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `RLS not enabled on ${table}`,
    );
  }
});

test("every table has at least one policy", () => {
  const migration = sql();
  for (const table of TENANT_TABLES) {
    assert.match(
      migration,
      new RegExp(`on public\\.${table} for `),
      `no policy for ${table}`,
    );
  }
});

test("leads has no industry-specific columns", () => {
  const migration = sql();
  const leadsBlock = migration.slice(
    migration.indexOf("create table public.leads"),
    migration.indexOf("create trigger leads_set_updated_at"),
  );
  for (const forbidden of [
    "budget",
    "property_type",
    "bedrooms",
    "financing",
    "location",
    "\\btimeline\\b",
    "service",
    "doctor",
    "appointment_date",
    "insurance",
    "urgency",
  ]) {
    assert.doesNotMatch(
      leadsBlock,
      new RegExp(forbidden),
      `leads defines an industry column matching /${forbidden}/`,
    );
  }
  assert.match(leadsBlock, /custom_data\s+jsonb/);
});

test("messages has no organization_id column (access via conversation)", () => {
  const migration = sql();
  const messagesBlock = migration.slice(
    migration.indexOf("create table public.messages"),
    migration.indexOf("create index messages_"),
  );
  assert.doesNotMatch(messagesBlock, /organization_id/);
});

test("SECURITY DEFINER helpers pin a fixed empty search_path", () => {
  const migration = sql();
  const definerFns = [...migration.matchAll(/create or replace function (private\.\w+)[\s\S]*?\$\$/g)];
  assert.ok(definerFns.length >= 4, "expected several private helper functions");
  for (const [block, name] of definerFns) {
    if (!/security definer/.test(block)) continue;
    assert.match(
      block,
      /set search_path = ''/,
      `${name} is SECURITY DEFINER without a fixed search_path`,
    );
  }
});

test("membership helpers are SECURITY DEFINER (avoids RLS recursion)", () => {
  const migration = sql();
  assert.match(
    migration,
    /function private\.user_org_ids\(\)[\s\S]*?security definer/,
  );
  assert.match(
    migration,
    /function private\.has_org_role\([\s\S]*?security definer/,
  );
});

test("organization_members policies block self role-escalation", () => {
  const migration = sql();
  const updatePolicy = migration.slice(
    migration.indexOf("organization_members_update_admins"),
  );
  assert.match(
    updatePolicy.slice(0, 600),
    /user_id <> \(select auth\.uid\(\)\)/,
  );
});

test("authenticated gets table privileges; anon gets none", () => {
  const migration = sql();
  assert.match(migration, /grant select, insert, update, delete on[\s\S]*?to authenticated/);
  assert.match(migration, /grant select, insert on public\.messages, public\.lead_events to authenticated/);
  // no grants to anon anywhere
  assert.doesNotMatch(migration, /grant[\s\S]*?to anon/);
});

test("config writes are restricted to owner/admin", () => {
  const migration = sql();
  for (const op of ["insert", "update", "delete"]) {
    assert.match(
      migration,
      new RegExp(
        `organization_configs_${op}_admins[\\s\\S]*?has_org_role\\([^)]*array\\['owner', 'admin'\\]`,
      ),
      `config ${op} policy is not owner/admin-only`,
    );
  }
});

test("no NEXT_PUBLIC_ service role and no hardcoded uuids in migrations", () => {
  const migration = sql();
  assert.doesNotMatch(migration, /NEXT_PUBLIC/);
  assert.doesNotMatch(migration, /service_role_key|SERVICE_ROLE_KEY/);
  // no literal org uuids seeded
  assert.doesNotMatch(
    migration,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
});
