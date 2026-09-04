import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProposedActions,
  validateFutureTimestamp,
  normalizeNote,
  AGENT_ACTION_TYPES,
  AI_PROPOSABLE_ACTION_TYPES,
  MAX_ACTIONS_PER_TURN,
} from "./actions.ts";

const NOW = new Date("2026-09-04T12:00:00Z");
const future = "2026-09-05T15:00:00Z";
const past = "2026-09-03T15:00:00Z";

test("the registry has all 7 actions; 5 are AI-proposable", () => {
  assert.deepEqual([...AGENT_ACTION_TYPES], [
    "update_lead_status",
    "create_follow_up",
    "request_human_handoff",
    "mark_qualified",
    "book_appointment",
    "reschedule_appointment",
    "cancel_appointment",
  ]);
  assert.deepEqual([...AI_PROPOSABLE_ACTION_TYPES], [
    "create_follow_up",
    "request_human_handoff",
    "book_appointment",
    "reschedule_appointment",
    "cancel_appointment",
  ]);
});

test("validateFutureTimestamp: future ok, past/malformed/too-far rejected", () => {
  assert.equal(validateFutureTimestamp(future, NOW).ok, true);
  assert.equal(validateFutureTimestamp(past, NOW).ok, false);
  assert.match(validateFutureTimestamp(past, NOW).error ?? "", /past/);
  assert.equal(validateFutureTimestamp("not a date", NOW).ok, false);
  assert.equal(validateFutureTimestamp("", NOW).ok, false);
  assert.equal(validateFutureTimestamp(42, NOW).ok, false);
  assert.equal(validateFutureTimestamp("2099-01-01T00:00:00Z", NOW).ok, false); // > 365d
  // bare datetime is read as UTC and normalised
  const bare = validateFutureTimestamp("2026-09-05T15:00", NOW);
  assert.equal(bare.ok, true);
  assert.equal(bare.iso, "2026-09-05T15:00:00.000Z");
});

test("parseProposedActions: valid create_follow_up + handoff", () => {
  const { actions, rejected } = parseProposedActions(
    [
      { type: "create_follow_up", scheduled_at: future, reason: "call me tomorrow" },
      { type: "request_human_handoff", scheduled_at: null, reason: "wants a person" },
    ],
    NOW,
  );
  assert.equal(rejected.length, 0);
  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0], {
    type: "create_follow_up",
    scheduledAt: "2026-09-05T15:00:00.000Z",
    reason: "call me tomorrow",
  });
  assert.deepEqual(actions[1], { type: "request_human_handoff", reason: "wants a person" });
});

test("parseProposedActions rejects unknown / non-proposable / malformed", () => {
  const { actions, rejected } = parseProposedActions(
    [
      { type: "mark_qualified" }, // real action, but NOT AI-proposable
      { type: "delete_all_leads" }, // unknown
      { type: "update_lead_status", status: "won" }, // not proposable
      "nope",
      { noType: true },
      { type: "create_follow_up", scheduled_at: past }, // past date
      { type: "create_follow_up", scheduled_at: "garbage" },
    ],
    NOW,
  );
  assert.equal(actions.length, 0);
  assert.ok(rejected.some((r) => r.includes("mark_qualified")));
  assert.ok(rejected.some((r) => r.includes("delete_all_leads")));
  assert.ok(rejected.some((r) => r.includes("past")));
});

test("parseProposedActions caps per turn and dedupes by type", () => {
  const many = Array.from({ length: 8 }, () => ({
    type: "request_human_handoff",
  }));
  const { actions } = parseProposedActions(many, NOW);
  assert.equal(actions.length, 1); // deduped by type

  const mixed = parseProposedActions(
    [
      { type: "request_human_handoff" },
      { type: "create_follow_up", scheduled_at: future },
      { type: "create_follow_up", scheduled_at: future },
    ],
    NOW,
  );
  assert.ok(mixed.actions.length <= MAX_ACTIONS_PER_TURN);
  assert.equal(mixed.actions.filter((a) => a.type === "create_follow_up").length, 1);
});

test("parseProposedActions tolerates non-array input", () => {
  assert.deepEqual(parseProposedActions(null, NOW), { actions: [], rejected: [] });
  assert.deepEqual(parseProposedActions("x", NOW), { actions: [], rejected: [] });
  assert.deepEqual(parseProposedActions(undefined, NOW), { actions: [], rejected: [] });
});

test("parseProposedActions: book_appointment / reschedule_appointment need a future scheduled_at", () => {
  const { actions, rejected } = parseProposedActions(
    [
      { type: "book_appointment", scheduled_at: future, reason: "prefers mornings" },
    ],
    NOW,
  );
  assert.equal(rejected.length, 0);
  assert.deepEqual(actions, [
    { type: "book_appointment", startsAt: "2026-09-05T15:00:00.000Z", reason: "prefers mornings" },
  ]);

  const bad = parseProposedActions(
    [{ type: "reschedule_appointment", scheduled_at: past }],
    NOW,
  );
  assert.equal(bad.actions.length, 0);
  assert.ok(bad.rejected.some((r) => r.includes("reschedule_appointment")));
});

test("parseProposedActions: cancel_appointment only needs an optional reason", () => {
  const { actions } = parseProposedActions(
    [{ type: "cancel_appointment", reason: "change of plans" }],
    NOW,
  );
  assert.deepEqual(actions, [{ type: "cancel_appointment", reason: "change of plans" }]);

  const noReason = parseProposedActions([{ type: "cancel_appointment" }], NOW);
  assert.deepEqual(noReason.actions, [{ type: "cancel_appointment", reason: null }]);
});

test("book_appointment / reschedule_appointment coexist with other action types in one turn", () => {
  const { actions, rejected } = parseProposedActions(
    [
      { type: "book_appointment", scheduled_at: future },
      { type: "request_human_handoff", reason: "wants a person too" },
    ],
    NOW,
  );
  assert.equal(rejected.length, 0);
  assert.equal(actions.length, 2);
});

test("normalizeNote trims, caps, and nulls empties", () => {
  assert.equal(normalizeNote("  hello  "), "hello");
  assert.equal(normalizeNote(""), null);
  assert.equal(normalizeNote("   "), null);
  assert.equal(normalizeNote(123), null);
  assert.equal((normalizeNote("x".repeat(999)) ?? "").length, 500);
});
