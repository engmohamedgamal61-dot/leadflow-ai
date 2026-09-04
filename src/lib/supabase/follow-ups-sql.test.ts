import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260904150000_lead_follow_ups.sql"),
  "utf8",
);

test("lead_follow_ups has the required columns", () => {
  assert.match(SQL, /create table public\.lead_follow_ups/);
  for (const col of [
    "organization_id",
    "lead_id",
    "conversation_id",
    "scheduled_at",
    "status",
    "note",
    "source",
    "creation_request_id",
    "created_at",
    "updated_at",
  ]) {
    assert.match(SQL, new RegExp(`\\b${col}\\b`), `missing column ${col}`);
  }
});

test("follow_up_status enum is exactly pending / completed / cancelled", () => {
  assert.match(
    SQL,
    /create type public\.follow_up_status as enum \('pending', 'completed', 'cancelled'\)/,
  );
});

test("conversation_id is nullable and survives conversation deletion", () => {
  assert.match(
    SQL,
    /conversation_id\s+uuid references public\.conversations \(id\) on delete set null/,
  );
});

test("idempotency: unique index on (lead_id, creation_request_id)", () => {
  assert.match(
    SQL,
    /create unique index lead_follow_ups_lead_creation_request_id_key\s+on public\.lead_follow_ups \(lead_id, creation_request_id\)/,
  );
});

test("indexes exist for the dashboard queries", () => {
  assert.match(SQL, /create index lead_follow_ups_lead_id_idx/);
  assert.match(
    SQL,
    /create index lead_follow_ups_org_status_scheduled_idx\s+on public\.lead_follow_ups \(organization_id, status, scheduled_at\)/,
  );
});

test("RLS is enabled and reuses the existing helper + role sets", () => {
  assert.match(SQL, /alter table public\.lead_follow_ups enable row level security/);
  assert.match(
    SQL,
    /lead_follow_ups_select_members[\s\S]*?organization_id in \(select private\.user_org_ids\(\)\)/,
  );
  assert.match(
    SQL,
    /lead_follow_ups_insert_writers[\s\S]*?has_org_role\(organization_id, array\['owner', 'admin', 'manager', 'sales'\]\)/,
  );
  assert.match(
    SQL,
    /lead_follow_ups_update_writers[\s\S]*?has_org_role\(organization_id, array\['owner', 'admin', 'manager', 'sales'\]\)/,
  );
});

test("no DELETE grant / policy, and no anon access, and no existing table changed", () => {
  assert.doesNotMatch(SQL, /for delete/i);
  assert.doesNotMatch(SQL, /to anon/);
  assert.doesNotMatch(SQL, /alter table public\.(leads|conversations|messages|lead_events|organizations)/);
  assert.doesNotMatch(SQL, /drop policy/i);
});
