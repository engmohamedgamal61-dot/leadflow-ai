import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function allSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

function onboardingSql(): string {
  return readFileSync(
    join(MIGRATIONS_DIR, "20260904140000_auth_onboarding.sql"),
    "utf8",
  );
}

test("onboarding adds the create_organization_with_owner function", () => {
  assert.match(
    onboardingSql(),
    /create or replace function public\.create_organization_with_owner\(\s*p_name\s+text,\s*p_industry_template_id\s+text\s*\)/,
  );
});

test("the function is SECURITY DEFINER with a pinned empty search_path", () => {
  const sql = onboardingSql();
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
});

test("the owner is always auth.uid() — never a parameter", () => {
  const sql = onboardingSql();
  assert.match(sql, /v_uid\s+uuid\s*:=\s*\(select auth\.uid\(\)\)/);
  // membership insert uses the derived uid + literal 'owner'
  assert.match(
    sql,
    /insert into public\.organization_members \(organization_id, user_id, role\)\s*values \(v_org\.id, v_uid, 'owner'\)/,
  );
  // there is no user-id / role parameter on the function signature
  assert.doesNotMatch(sql, /p_user_id|p_role\b/);
});

test("it refuses a caller who already belongs to an organization", () => {
  assert.match(
    onboardingSql(),
    /if exists \(\s*select 1 from public\.organization_members where user_id = v_uid\s*\)\s*then\s*raise exception/,
  );
});

test("it creates the empty organization_configs row (overrides only)", () => {
  assert.match(
    onboardingSql(),
    /insert into public\.organization_configs \(organization_id, config\)\s*values \(v_org\.id, '\{\}'::jsonb\)/,
  );
});

test("execute is granted to authenticated only (revoked from public)", () => {
  const sql = onboardingSql();
  assert.match(
    sql,
    /revoke all on function public\.create_organization_with_owner\(text, text\) from public/,
  );
  assert.match(
    sql,
    /grant execute on function public\.create_organization_with_owner\(text, text\)\s*to authenticated/,
  );
});

test("onboarding migration does not weaken or bypass RLS", () => {
  const sql = onboardingSql();
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.doesNotMatch(sql, /drop policy/i);
  assert.doesNotMatch(sql, /alter table[\s\S]*?no force row level security/i);
  assert.doesNotMatch(sql, /to anon/); // no new anon grants
});

test("no new tables or destructive table changes for auth/onboarding", () => {
  const sql = onboardingSql();
  assert.doesNotMatch(sql, /create table/i);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /drop column/i);
});

test("the full migration set still has RLS enabled on every tenant table", () => {
  const sql = allSql();
  for (const t of [
    "organizations",
    "organization_members",
    "organization_configs",
    "leads",
    "conversations",
    "messages",
    "lead_events",
  ]) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${t} enable row level security`),
      t,
    );
  }
});
