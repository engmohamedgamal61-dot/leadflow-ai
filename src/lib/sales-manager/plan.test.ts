import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIDENCE_CLARIFY_THRESHOLD,
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

test("REGRESSION: an unsupported enum value among valid ones is NEVER silently dropped", () => {
  const r = parsePlan(
    raw([{ type: "lead_count", filters: { opportunity: ["hot", "enterprise"] } }]),
  );
  assert.equal(r.ok, false, "must not execute just the 'hot' part");
  if (!r.ok) {
    assert.equal(r.reason, "unsupported_filter_value");
    assert.equal(r.field, "opportunity");
    assert.equal(r.value, "enterprise");
  }
});

test("unsupported values are rejected across every strict filter/field", () => {
  const cases: [unknown[], string][] = [
    [[{ type: "lead_count", filters: { status: ["qualified", "vip"] } }], "status"],
    [[{ type: "lead_search", filters: {}, sort: "rowid" }], "sort"],
    [[{ type: "lead_search", filters: { created_within: "since_forever" } }], "created_within"],
    [[{ type: "lead_search", filters: { stale_for: "ages" } }], "stale_for"],
    [[{ type: "lead_count_grouped", group_by: "ip_address" }], "group_by"],
    [[{ type: "compare_periods", metric: "revenue", period: "week" }], "metric"],
    [[{ type: "compare_periods", metric: "won", period: "decade" }], "period"],
    [[{ type: "appointment_count", when: "someday" }], "when"],
    [[{ type: "followup_search", state: "snoozed" }], "state"],
    [[{ type: "appointment_search", status: ["scheduled", "ghosted"] }], "status"],
    [[{ type: "lead_lookup", by: "ssn", value: "x" }], "by"],
  ];
  for (const [ops, field] of cases) {
    const r = parsePlan(raw(ops));
    assert.equal(r.ok, false, `${field} unsupported value must reject`);
    if (!r.ok) {
      assert.equal(r.reason, "unsupported_filter_value");
      assert.equal(r.field, field);
    }
  }
});

test("a missing required scalar (group_by / metric) is rejected, not defaulted", () => {
  assert.equal(parsePlan(raw([{ type: "lead_count_grouped" }])).ok, false);
  assert.equal(parsePlan(raw([{ type: "compare_periods", period: "week" }])).ok, false);
});

test("an absent optional enum is fine (safe default, no clarification)", () => {
  const r = parsePlan(raw([{ type: "lead_search", filters: { status: ["qualified"] } }]));
  assert.equal(r.ok, true);
  if (r.ok && r.plan.operations[0].type === "lead_search") {
    assert.equal(r.plan.operations[0].sort, "priority_desc");
    assert.equal(r.plan.operations[0].filters.createdWithin, "all_time");
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

test("confidence: absent → 1; valid → passed through; out-of-range / non-number → rejected", () => {
  const absent = parsePlan(raw([{ type: "lead_count", filters: {} }]));
  assert.equal(absent.ok, true);
  if (absent.ok) assert.equal(absent.plan.confidence, 1);

  const valid = parsePlan(raw([{ type: "lead_count", filters: {} }], { confidence: 0.2 }));
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.plan.confidence, 0.2);

  for (const bad of [5, -1, 1.5, "high", NaN, Infinity, {}]) {
    const r = parsePlan(raw([{ type: "lead_count", filters: {} }], { confidence: bad }));
    assert.equal(r.ok, false, `confidence=${JSON.stringify(bad)} must reject`);
    if (!r.ok) assert.equal(r.reason, "invalid_confidence");
  }
  assert.ok(CONFIDENCE_CLARIFY_THRESHOLD > 0 && CONFIDENCE_CLARIFY_THRESHOLD < 0.6);
});

test("ADVERSARIAL: a planner-supplied `accuracy` (or org_id) field is rejected as unknown", () => {
  assert.equal(
    parsePlan(raw([{ type: "lead_count", filters: {}, accuracy: "exact" }])).ok,
    false,
  );
  assert.equal(
    parsePlan(raw([{ type: "lead_count", filters: {}, organization_id: "victim-org" }])).ok,
    false,
  );
  assert.equal(
    parsePlan(raw([{ type: "lead_count", filters: { organization_id: "victim-org" } }])).ok,
    false,
  );
});

test("lead_lookup: valid by/value parses; short or bad values are rejected", () => {
  const ok = parsePlan(raw([{ type: "lead_lookup", by: "name", value: "  أحمد محمد  " }]));
  assert.equal(ok.ok, true);
  if (ok.ok && ok.plan.operations[0].type === "lead_lookup") {
    assert.equal(ok.plan.operations[0].by, "name");
    assert.equal(ok.plan.operations[0].value, "أحمد محمد");
  }
  const phone = parsePlan(raw([{ type: "lead_lookup", by: "phone", value: "+20 100 123 4567" }]));
  assert.equal(phone.ok, true);
  if (phone.ok && phone.plan.operations[0].type === "lead_lookup") {
    assert.equal(phone.plan.operations[0].value, "+201001234567");
  }
  assert.equal(parsePlan(raw([{ type: "lead_lookup", by: "name", value: "a" }])).ok, false);
  assert.equal(parsePlan(raw([{ type: "lead_lookup", by: "phone", value: "12" }])).ok, false);
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
