import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInboundRequest, INBOUND_ACTIONS } from "./inbound-validation.ts";

const NOW = new Date("2026-09-07T12:00:00.000Z");
const LEAD = "11111111-1111-1111-1111-111111111111";
const future = "2026-09-10T09:00:00.000Z";

test("only three actions are allowlisted", () => {
  assert.deepEqual([...INBOUND_ACTIONS], [
    "update_lead_status",
    "create_follow_up",
    "request_human_handoff",
  ]);
});

test("rejects an unknown action (no path to arbitrary commands)", () => {
  const r = parseInboundRequest(
    { id: "k1", action: "delete_all_leads", leadId: LEAD },
    NOW,
  );
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "action_not_allowed");
});

test("requires an idempotency id", () => {
  const r = parseInboundRequest({ action: "request_human_handoff", leadId: LEAD }, NOW);
  assert.equal(r.ok === false && r.code, "id_required");
});

test("requires a valid lead uuid", () => {
  const r = parseInboundRequest(
    { id: "k", action: "request_human_handoff", leadId: "42" },
    NOW,
  );
  assert.equal(r.ok === false && r.code, "lead_id_invalid");
});

test("update_lead_status: validates the status against the enum", () => {
  assert.equal(
    parseInboundRequest(
      { id: "k", action: "update_lead_status", leadId: LEAD, status: "banana" },
      NOW,
    ).ok,
    false,
  );
  const ok = parseInboundRequest(
    { id: "k", action: "update_lead_status", leadId: LEAD, status: "contacted" },
    NOW,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.value.type, "update_lead_status");
});

test("create_follow_up: requires a future timestamp", () => {
  assert.equal(
    parseInboundRequest(
      { id: "k", action: "create_follow_up", leadId: LEAD, scheduledAt: "2020-01-01" },
      NOW,
    ).ok,
    false,
  );
  const ok = parseInboundRequest(
    { id: "k", action: "create_follow_up", leadId: LEAD, scheduledAt: future, note: "call" },
    NOW,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.value.type === "create_follow_up" && ok.value.note, "call");
});

test("snake_case aliases are accepted (lead_id, scheduled_at, idempotency_key)", () => {
  const ok = parseInboundRequest(
    {
      idempotency_key: "k",
      action: "create_follow_up",
      lead_id: LEAD,
      scheduled_at: future,
    },
    NOW,
  );
  assert.equal(ok.ok, true);
});

test("non-object body is rejected", () => {
  assert.equal(parseInboundRequest("nope", NOW).ok, false);
  assert.equal(parseInboundRequest(null, NOW).ok, false);
});
