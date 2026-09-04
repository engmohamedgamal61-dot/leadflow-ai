import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260904180000_calendar_integration.sql"),
  "utf8",
);

test("btree_gist is enabled (required for the no-overlap exclusion constraint)", () => {
  assert.match(SQL, /create extension if not exists btree_gist/);
});

test("organization_calendar_connections: one per org, RLS enabled", () => {
  assert.match(SQL, /create table public\.organization_calendar_connections/);
  assert.match(SQL, /organization_id\s+uuid not null unique/);
  assert.match(SQL, /alter table public\.organization_calendar_connections enable row level security/);
});

test("both OAuth token columns are revoked from authenticated (never reach the browser)", () => {
  assert.match(SQL, /revoke select on public\.organization_calendar_connections from authenticated/);
  const grant = SQL.match(/grant select\s*\(([^)]*)\)\s*on public\.organization_calendar_connections/);
  assert.ok(grant);
  assert.doesNotMatch(grant![1], /access_token_encrypted/);
  assert.doesNotMatch(grant![1], /refresh_token_encrypted/);
});

test("calendar connection writes are owner/admin only; reads are any member", () => {
  assert.match(SQL, /calendar_connections_select_members[\s\S]*?user_org_ids\(\)/);
  for (const op of ["insert", "update", "delete"]) {
    assert.match(
      SQL,
      new RegExp(`calendar_connections_${op}_admins[\\s\\S]*?has_org_role\\(organization_id, array\\['owner', 'admin'\\]`),
      `${op} not owner/admin only`,
    );
  }
});

test("appointments: correct FKs, ends-after-starts check, RLS enabled", () => {
  assert.match(SQL, /create table public\.appointments/);
  assert.match(SQL, /lead_id\s+uuid not null references public\.leads/);
  assert.match(SQL, /constraint appointments_ends_after_starts check \(ends_at > starts_at\)/);
  assert.match(SQL, /alter table public\.appointments enable row level security/);
});

test("appointments writes are owner/admin/manager/sales; reads are any member; no delete policy", () => {
  assert.match(SQL, /appointments_select_members[\s\S]*?user_org_ids\(\)/);
  for (const op of ["insert", "update"]) {
    assert.match(
      SQL,
      new RegExp(`appointments_${op}_writers[\\s\\S]*?has_org_role\\(organization_id, array\\['owner', 'admin', 'manager', 'sales'\\]`),
    );
  }
  assert.doesNotMatch(SQL, /appointments_delete/);
});

test("the no-overlap exclusion constraint guards active appointments per calendar connection", () => {
  assert.match(SQL, /exclude using gist/);
  assert.match(SQL, /calendar_connection_id with =/);
  assert.match(SQL, /tstzrange\(starts_at, ends_at, '\[\)'\) with &&/);
  assert.match(SQL, /status in \('scheduled', 'rescheduled'\)/);
});

test("idempotency: a NULL-distinct unique index on (lead_id, creation_request_id)", () => {
  assert.match(
    SQL,
    /create unique index appointments_lead_creation_request_id_key\s+on public\.appointments \(lead_id, creation_request_id\)/,
  );
});

test("no existing table restructured, no policy dropped", () => {
  assert.doesNotMatch(SQL, /drop (table|policy|column)/i);
  assert.doesNotMatch(SQL, /alter table public\.(leads|lead_events|organizations|organization_members|whatsapp_connections)\b/);
});
