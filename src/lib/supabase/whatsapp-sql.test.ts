import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260904170000_whatsapp_integration.sql"),
  "utf8",
);

test("whatsapp_connections: one per org, unique phone_number_id, RLS enabled", () => {
  assert.match(SQL, /create table public\.whatsapp_connections/);
  assert.match(SQL, /organization_id\s+uuid not null unique/);
  assert.match(SQL, /phone_number_id\s+text not null unique/);
  assert.match(SQL, /alter table public\.whatsapp_connections enable row level security/);
});

test("the access token column is revoked from authenticated (never reaches the browser)", () => {
  assert.match(SQL, /revoke select on public\.whatsapp_connections from authenticated/);
  assert.match(
    SQL,
    /grant select\s*\([^)]*status[^)]*\)\s*on public\.whatsapp_connections to authenticated/,
  );
  // access_token_encrypted must NOT be in the granted column list
  const grant = SQL.match(/grant select\s*\(([^)]*)\)\s*on public\.whatsapp_connections/);
  assert.ok(grant);
  assert.doesNotMatch(grant![1], /access_token_encrypted/);
});

test("connection writes are owner/admin only; reads are any member", () => {
  assert.match(SQL, /whatsapp_connections_select_members[\s\S]*?user_org_ids\(\)/);
  for (const op of ["insert", "update", "delete"]) {
    assert.match(
      SQL,
      new RegExp(`whatsapp_connections_${op}_admins[\\s\\S]*?has_org_role\\(organization_id, array\\['owner', 'admin'\\]`),
      `${op} not owner/admin only`,
    );
  }
});

test("whatsapp_inbound_events: provider_message_id PK, service-role only", () => {
  assert.match(SQL, /create table public\.whatsapp_inbound_events/);
  assert.match(SQL, /provider_message_id text primary key/);
  assert.match(SQL, /revoke all on public\.whatsapp_inbound_events from authenticated/);
  assert.match(SQL, /grant insert, select on public\.whatsapp_inbound_events to service_role/);
});

test("messages gains provider metadata; provider_message_id is uniquely indexed", () => {
  for (const c of ["channel", "provider", "provider_message_id", "delivery_status", "provider_metadata"]) {
    assert.match(SQL, new RegExp(`add column\\s+${c}\\b`), `messages missing ${c}`);
  }
  assert.match(
    SQL,
    /create unique index messages_provider_message_id_key\s+on public\.messages \(provider_message_id\)\s+where provider_message_id is not null/,
  );
});

test("conversations gains WhatsApp mapping + session-window column, uniquely indexed", () => {
  assert.match(SQL, /add column external_contact_id text/);
  assert.match(SQL, /add column last_inbound_at\s+timestamptz/);
  assert.match(
    SQL,
    /create unique index conversations_org_channel_contact_key\s+on public\.conversations \(organization_id, channel, external_contact_id\)/,
  );
});

test("no existing table restructured, no policy dropped", () => {
  assert.doesNotMatch(SQL, /drop (table|policy|column)/i);
  assert.doesNotMatch(SQL, /alter table public\.(leads|lead_events|organizations|organization_members)\b/);
});
