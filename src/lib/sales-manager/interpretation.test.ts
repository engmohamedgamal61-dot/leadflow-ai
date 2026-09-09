import { test } from "node:test";
import assert from "node:assert/strict";
import { ASK_INTENTS } from "./intents.ts";
import {
  CONFIDENCE_CLARIFY_THRESHOLD,
  INTERPRETATION_JSON_SCHEMA,
  parseInterpretation,
  resolveTimeRange,
  shouldClarify,
  type Interpretation,
} from "./interpretation.ts";

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: "total_leads",
    filters: { status: null, temperature: null, source: null },
    time_range: "all_time",
    limit: null,
    confidence: 0.9,
    needs_clarification: false,
    clarification_question: null,
    ...over,
  };
}

test("a well-formed interpretation parses and is normalised", () => {
  const r = parseInterpretation(
    raw({
      intent: "qualified_leads",
      filters: { status: "QUALIFIED", temperature: "Hot", source: " WhatsApp! " },
      time_range: "this_week",
      limit: 5,
      confidence: 0.82,
    }),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.intent, "qualified_leads");
  assert.equal(r.value.filters.status, "qualified");
  assert.equal(r.value.filters.temperature, "hot");
  assert.equal(r.value.filters.source, "whatsapp");
  assert.equal(r.value.timeRange, "this_week");
  assert.equal(r.value.limit, 5);
});

test("an unknown / injected intent is REJECTED — never mapped to a default", () => {
  for (const bad of [
    "needs_attention; DROP TABLE leads",
    "arbitrary_sql",
    "SELECT * FROM organizations",
    "",
    "PRIORITY_LEADS",
    123,
    null,
  ]) {
    const r = parseInterpretation(raw({ intent: bad }));
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be rejected`);
    if (!r.ok) assert.equal(r.reason, bad === 123 || bad === null || bad === "" ? "unknown_intent" : "unknown_intent");
  }
});

test("non-object input is rejected", () => {
  assert.deepEqual(parseInterpretation(null), { ok: false, reason: "not_object" });
  assert.deepEqual(parseInterpretation("{}"), { ok: false, reason: "not_object" });
  assert.deepEqual(parseInterpretation([]), { ok: false, reason: "not_object" });
});

test("unknown filter / time-range values are dropped, not trusted", () => {
  const r = parseInterpretation(
    raw({
      intent: "total_leads",
      filters: { status: "vip", temperature: "lukewarm", source: "x" },
      time_range: "since_the_dawn_of_time",
      limit: 999,
    }),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.filters.status, null);
  assert.equal(r.value.filters.temperature, null);
  assert.equal(r.value.filters.source, null, "a 1-char source is too short to keep");
  assert.equal(r.value.timeRange, "all_time");
  assert.equal(r.value.limit, 8, "limit clamped to the card budget");
});

test("confidence is coerced into 0..1", () => {
  assert.equal((parseInterpretation(raw({ confidence: 5 })) as { value: Interpretation }).value.confidence, 1);
  assert.equal((parseInterpretation(raw({ confidence: -2 })) as { value: Interpretation }).value.confidence, 0);
  assert.equal((parseInterpretation(raw({ confidence: "x" })) as { value: Interpretation }).value.confidence, 0);
});

test("shouldClarify: low confidence OR the model's own flag", () => {
  const base: Interpretation = {
    intent: "total_leads",
    filters: { status: null, temperature: null, source: null },
    timeRange: "all_time",
    limit: null,
    confidence: 0.9,
    needsClarification: false,
    clarificationQuestion: null,
  };
  assert.equal(shouldClarify(base), false);
  assert.equal(shouldClarify({ ...base, confidence: CONFIDENCE_CLARIFY_THRESHOLD - 0.01 }), true);
  assert.equal(shouldClarify({ ...base, needsClarification: true }), true);
});

test("resolveTimeRange produces sane rolling windows", () => {
  const now = new Date("2026-09-08T15:00:00Z");
  assert.deepEqual(resolveTimeRange("all_time", now), { from: null, to: null });

  const today = resolveTimeRange("today", now);
  assert.equal(today.from?.toISOString(), "2026-09-08T00:00:00.000Z");
  assert.equal(today.to, null);

  const yesterday = resolveTimeRange("yesterday", now);
  assert.equal(yesterday.from?.toISOString(), "2026-09-07T00:00:00.000Z");
  assert.equal(yesterday.to?.toISOString(), "2026-09-08T00:00:00.000Z");

  const week = resolveTimeRange("this_week", now);
  assert.equal(week.from?.toISOString(), "2026-09-01T15:00:00.000Z");

  const lastWeek = resolveTimeRange("last_week", now);
  assert.equal(lastWeek.from?.toISOString(), "2026-08-25T15:00:00.000Z");
  assert.equal(lastWeek.to?.toISOString(), "2026-09-01T15:00:00.000Z");
});

test("the JSON schema only allows the allowlisted intents", () => {
  const enums = INTERPRETATION_JSON_SCHEMA.properties.intent.enum;
  assert.deepEqual([...enums].sort(), [...ASK_INTENTS].sort());
});
