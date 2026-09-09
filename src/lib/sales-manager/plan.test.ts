import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTENT_TO_OPERATION,
  MAX_OPERATIONS,
  OPERATION_TYPES,
  PLAN_JSON_SCHEMA,
  parsePlan,
  resolveTimeRange,
  type PlannedOperation,
} from "./plan.ts";
import { ASK_INTENTS } from "./intents.ts";

function raw(operations: unknown[], over: Record<string, unknown> = {}) {
  return {
    operations,
    needs_clarification: false,
    clarification_question: null,
    ...over,
  };
}

test("a well-formed multi-operation plan parses and normalises", () => {
  const r = parsePlan(
    raw([
      {
        type: "lead_search",
        filters: { status: ["QUALIFIED"], opportunity: ["Hot"], source: ["Instagram"], created_within: "this_month" },
        sort: "priority_desc",
        limit: 5,
      },
      { type: "pipeline_metrics", time_range: "this_week" },
    ]),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.operations.length, 2);
  const [search, pipeline] = r.plan.operations;
  assert.equal(search.type, "lead_search");
  if (search.type === "lead_search") {
    assert.deepEqual(search.filters.status, ["qualified"]);
    assert.deepEqual(search.filters.opportunity, ["hot"]);
    assert.deepEqual(search.filters.source, ["instagram"]);
    assert.equal(search.filters.createdWithin, "this_month");
    assert.equal(search.sort, "priority_desc");
    assert.equal(search.limit, 5);
  }
  assert.equal(pipeline.type, "pipeline_metrics");
});

test("unknown operation type → whole plan rejected", () => {
  for (const bad of ["run_raw_sql", "select", "drop_table", "delete_leads", ""]) {
    const r = parsePlan(raw([{ type: bad }]));
    assert.equal(r.ok, false, `${bad} must be rejected`);
    if (!r.ok) assert.ok(["unknown_operation", "invalid_operation"].includes(r.reason));
  }
});

test("unknown filter key → whole plan rejected", () => {
  const r = parsePlan(
    raw([{ type: "lead_count", filters: { region: "riyadh", organization_id: "x" } }]),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unknown_field");
});

test("unknown field on an operation object → rejected", () => {
  const r = parsePlan(raw([{ type: "pipeline_metrics", time_range: "today", secret_sql: "x" }]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unknown_field");
});

test("unknown enum VALUES inside a list are dropped, not fatal", () => {
  const r = parsePlan(
    raw([{ type: "lead_count", filters: { status: ["qualified", "vip", "banned"] } }]),
  );
  assert.equal(r.ok, true);
  if (r.ok && r.plan.operations[0].type === "lead_count") {
    assert.deepEqual(r.plan.operations[0].filters.status, ["qualified"]);
  }
});

test("unsupported sort / group_by / metric → rejected or safely defaulted", () => {
  // scalar enum with no safe default → reject
  assert.equal(parsePlan(raw([{ type: "lead_count_grouped", group_by: "ip_address" }])).ok, false);
  assert.equal(parsePlan(raw([{ type: "compare_periods", metric: "revenue", period: "week" }])).ok, false);
  // sort has a safe default
  const r = parsePlan(raw([{ type: "lead_search", filters: {}, sort: "rowid" }]));
  assert.equal(r.ok, true);
  if (r.ok && r.plan.operations[0].type === "lead_search") {
    assert.equal(r.plan.operations[0].sort, "priority_desc");
  }
});

test("limits are clamped to the per-operation cap", () => {
  const r = parsePlan(raw([{ type: "lead_search", filters: {}, sort: "score_desc", limit: 9999 }]));
  assert.equal(r.ok, true);
  if (r.ok && r.plan.operations[0].type === "lead_search") {
    assert.equal(r.plan.operations[0].limit, 25);
  }
  const r2 = parsePlan(raw([{ type: "lead_search", filters: {}, sort: "score_desc", limit: -3 }]));
  if (r2.ok && r2.plan.operations[0].type === "lead_search") {
    assert.equal(r2.plan.operations[0].limit, 1);
  }
});

test("operation count is capped", () => {
  const many = Array.from({ length: MAX_OPERATIONS + 1 }, () => ({ type: "lead_count", filters: {} }));
  const r = parsePlan(raw(many));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too_many_operations");
});

test("empty operations with no clarification flag → rejected", () => {
  assert.equal(parsePlan(raw([])).ok, false);
});

test("needs_clarification with no operations is a valid plan", () => {
  const r = parsePlan(raw([], { needs_clarification: true, clarification_question: "which leads?" }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.plan.needsClarification, true);
    assert.equal(r.plan.clarificationQuestion, "which leads?");
    assert.equal(r.plan.operations.length, 0);
  }
});

test("SQL-injection-shaped operation names and filter values cannot escape the allowlist", () => {
  const attempts = [
    raw([{ type: "lead_count'; DROP TABLE leads; --", filters: {} }]),
    raw([{ type: "lead_count", filters: { "status; delete from leads": ["x"] } }]),
    raw([{ type: "lead_details", lead_id: "1 OR 1=1" }]),
    raw([{ type: "lead_details", lead_id: "../../etc/passwd" }]),
  ];
  for (const a of attempts) assert.equal(parsePlan(a).ok, false);
});

test("a custom filter is kept only with a safe key shape and a value", () => {
  const ok = parsePlan(raw([{ type: "lead_count", filters: { custom: { key: "city", value: "Riyadh" } } }]));
  assert.equal(ok.ok, true);
  if (ok.ok && ok.plan.operations[0].type === "lead_count") {
    assert.deepEqual(ok.plan.operations[0].filters.custom, { key: "city", value: "Riyadh" });
  }
  // key with punctuation → the whole plan is rejected (malformed filter)
  assert.equal(
    parsePlan(raw([{ type: "lead_count", filters: { custom: { key: "city->>x", value: "y" } } }])).ok,
    false,
  );
});

test("non-object input is rejected", () => {
  assert.deepEqual(parsePlan(null), { ok: false, reason: "not_object" });
  assert.deepEqual(parsePlan("{}"), { ok: false, reason: "not_object" });
  assert.deepEqual(parsePlan([]), { ok: false, reason: "not_object" });
});

test("lead_details requires a real UUID", () => {
  assert.equal(
    parsePlan(raw([{ type: "lead_details", lead_id: "550e8400-e29b-41d4-a716-446655440000" }])).ok,
    true,
  );
  assert.equal(parsePlan(raw([{ type: "lead_details", lead_id: "not-a-uuid" }])).ok, false);
});

test("every keyword-router intent maps to a valid, allowlisted fallback operation", () => {
  for (const intent of ASK_INTENTS) {
    const op: PlannedOperation = INTENT_TO_OPERATION[intent];
    assert.ok((OPERATION_TYPES as readonly string[]).includes(op.type), `${intent} → ${op.type}`);
  }
});

test("the JSON schema only advertises the allowlisted operation types", () => {
  assert.deepEqual(
    [...PLAN_JSON_SCHEMA.properties.operations.items.properties.type.enum].sort(),
    [...OPERATION_TYPES].sort(),
  );
});

test("resolveTimeRange produces sane rolling windows", () => {
  const now = new Date("2026-09-09T15:00:00Z");
  assert.deepEqual(resolveTimeRange("all_time", now), { from: null, to: null });
  assert.equal(resolveTimeRange("today", now).from?.toISOString(), "2026-09-09T00:00:00.000Z");
  assert.equal(resolveTimeRange("this_week", now).from?.toISOString(), "2026-09-02T15:00:00.000Z");
  const lm = resolveTimeRange("last_month", now);
  assert.equal(lm.from?.toISOString(), "2026-07-11T15:00:00.000Z");
  assert.equal(lm.to?.toISOString(), "2026-08-10T15:00:00.000Z");
});
