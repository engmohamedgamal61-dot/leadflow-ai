import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260907120000_integration_hub.sql"),
  "utf8",
);

test("four integration tables exist with RLS enabled", () => {
  for (const t of [
    "integration_endpoints",
    "integration_event_outbox",
    "integration_deliveries",
    "integration_inbound_actions",
  ]) {
    assert.match(SQL, new RegExp(`create table public\\.${t}`), `missing ${t}`);
    assert.match(
      SQL,
      new RegExp(`alter table public\\.${t} enable row level security`),
      `RLS not enabled on ${t}`,
    );
  }
});

test("the signing secret column is revoked from authenticated (never reaches the browser)", () => {
  assert.match(SQL, /revoke select on public\.integration_endpoints from authenticated/);
  const grant = SQL.match(
    /grant select\s*\(([^)]*)\)\s*on public\.integration_endpoints to authenticated/,
  );
  assert.ok(grant);
  assert.doesNotMatch(grant![1], /secret_encrypted/);
  assert.match(grant![1], /secret_hint/);
});

test("endpoint writes are owner/admin only; reads are any member", () => {
  assert.match(SQL, /integration_endpoints_select_members[\s\S]*?user_org_ids\(\)/);
  for (const op of ["insert", "update", "delete"]) {
    assert.match(
      SQL,
      new RegExp(
        `integration_endpoints_${op}_admins[\\s\\S]*?has_org_role\\(organization_id, array\\['owner', 'admin'\\]`,
      ),
      `${op} not owner/admin only`,
    );
  }
});

test("outbox + inbound-audit rows are not writable by authenticated (service-role only)", () => {
  assert.match(SQL, /revoke all on public\.integration_event_outbox from authenticated/);
  assert.match(
    SQL,
    /grant select, insert, update on public\.integration_event_outbox to service_role/,
  );
  // deliveries + inbound_actions: members can read, only service_role writes
  assert.match(SQL, /grant select on public\.integration_deliveries to authenticated/);
  assert.match(SQL, /grant select on public\.integration_inbound_actions to authenticated/);
  assert.match(
    SQL,
    /grant select, insert, update on public\.integration_deliveries to service_role/,
  );
});

test("idempotency: unique fan-out + unique inbound key", () => {
  assert.match(
    SQL,
    /create unique index integration_deliveries_endpoint_event_key\s+on public\.integration_deliveries \(endpoint_id, outbox_event_id\);/,
  );
  assert.match(
    SQL,
    /create unique index integration_inbound_actions_idem_key\s+on public\.integration_inbound_actions \(endpoint_id, idempotency_key\)/,
  );
});

test("outbox is fed by triggers on the existing domain-event streams", () => {
  assert.match(SQL, /create trigger lead_events_integration_outbox\s+after insert on public\.lead_events/);
  assert.match(
    SQL,
    /create trigger lead_recovery_attempts_integration_outbox\s+after update on public\.lead_recovery_attempts/,
  );
  // canonical mapping present for the required events
  for (const c of [
    "lead.created",
    "lead.qualified",
    "lead.status_changed",
    "appointment.booked",
    "follow_up.executed",
    "handoff.requested",
    "recovery.started",
    "recovery.resolved",
  ]) {
    assert.ok(SQL.includes(`'${c}'`), `canonical event ${c} not mapped`);
  }
});

test("the trigger only enqueues when a matching enabled endpoint exists", () => {
  assert.match(
    SQL,
    /from public\.integration_endpoints e[\s\S]*?e\.enabled[\s\S]*?= any\(e\.subscribed_events\)/,
  );
});

test("delivery claim is FOR UPDATE SKIP LOCKED and service-role only", () => {
  assert.match(SQL, /create or replace function public\.claim_integration_deliveries/);
  assert.match(SQL, /for update skip locked/);
  assert.match(
    SQL,
    /grant execute on function public\.claim_integration_deliveries\(integer, interval\) to service_role/,
  );
  assert.match(
    SQL,
    /revoke all on function public\.claim_integration_deliveries\(integer, interval\) from authenticated/,
  );
});

test("no existing table restructured, no policy dropped", () => {
  assert.doesNotMatch(SQL, /drop (table|policy|column)/i);
  assert.doesNotMatch(
    SQL,
    /alter table public\.(leads|lead_events|organizations|organization_members|lead_recovery_attempts)\b/,
  );
});
