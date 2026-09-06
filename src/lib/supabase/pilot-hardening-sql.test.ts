import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260905200000_pilot_hardening.sql"),
  "utf8",
);

test("rate limiter: counter table lives in private, function in public", () => {
  assert.match(SQL, /create table private\.rate_limits/);
  assert.match(SQL, /create or replace function public\.hit_rate_limit\(/);
});

test("hit_rate_limit is SECURITY DEFINER with a pinned search_path", () => {
  assert.match(SQL, /security definer/);
  assert.match(SQL, /set search_path = ''/);
  assert.match(SQL, /returns boolean/);
});

test("hit_rate_limit is locked to service_role only (PostgREST-exposed but not callable by clients)", () => {
  for (const grantee of ["public", "anon", "authenticated"]) {
    assert.match(
      SQL,
      new RegExp(`revoke all on function public\\.hit_rate_limit\\(text, integer, integer\\) from ${grantee}`),
    );
  }
  assert.match(
    SQL,
    /grant execute on function public\.hit_rate_limit\(text, integer, integer\) to service_role/,
  );
});

test("hit_rate_limit resets the window atomically via on conflict do update", () => {
  assert.match(SQL, /on conflict \(key\) do update set/);
  assert.match(SQL, /make_interval\(secs => p_window_seconds\)/);
  assert.match(SQL, /return v_count <= p_max/);
});

test("organization_invitations: correct FKs, RLS enabled", () => {
  assert.match(SQL, /create table public\.organization_invitations/);
  assert.match(SQL, /organization_id uuid not null references public\.organizations \(id\) on delete cascade/);
  assert.match(SQL, /invited_by\s+uuid not null references auth\.users \(id\) on delete cascade/);
  assert.match(SQL, /token_hash\s+text not null unique/);
  assert.match(SQL, /alter table public\.organization_invitations enable row level security/);
});

test("invitations can NEVER grant owner (privilege-escalation guard at the column level)", () => {
  assert.match(SQL, /role\s+public\.organization_member_role not null\s*\n\s*check \(role <> 'owner'\)/);
});

test("one pending invite per (org, email), case-insensitive", () => {
  assert.match(
    SQL,
    /create unique index organization_invitations_pending_email\s+on public\.organization_invitations \(organization_id, lower\(email\)\)\s+where accepted_at is null/,
  );
});

test("invitations: read/insert/delete are owner+admin; NO update policy (acceptance is service-role only)", () => {
  for (const op of ["select", "insert", "delete"]) {
    assert.match(
      SQL,
      new RegExp(
        `organization_invitations_${op}_admins[\\s\\S]*?has_org_role\\(organization_id, array\\['owner', 'admin'\\]`,
      ),
    );
  }
  assert.doesNotMatch(SQL, /organization_invitations_update/);
});

test("organization_widget_settings: per-org key, disabled by default, RLS enabled", () => {
  assert.match(SQL, /create table public\.organization_widget_settings/);
  assert.match(SQL, /organization_id uuid primary key references public\.organizations \(id\) on delete cascade/);
  assert.match(SQL, /widget_key\s+uuid not null unique default gen_random_uuid\(\)/);
  assert.match(SQL, /enabled\s+boolean not null default false/);
  assert.match(SQL, /alter table public\.organization_widget_settings enable row level security/);
});

test("widget settings: any member reads; only owner/admin writes", () => {
  assert.match(
    SQL,
    /organization_widget_settings_select_members[\s\S]*?organization_id in \(select private\.user_org_ids\(\)\)/,
  );
  for (const op of ["insert", "update", "delete"]) {
    assert.match(
      SQL,
      new RegExp(
        `organization_widget_settings_${op}_admins[\\s\\S]*?has_org_role\\(organization_id, array\\['owner', 'admin'\\]`,
      ),
    );
  }
});

test("no existing table restructured, no policy dropped", () => {
  assert.doesNotMatch(SQL, /drop (table|policy|column)/i);
  assert.doesNotMatch(
    SQL,
    /alter table public\.(leads|lead_events|lead_follow_ups|organizations|organization_members)\b/,
  );
});
