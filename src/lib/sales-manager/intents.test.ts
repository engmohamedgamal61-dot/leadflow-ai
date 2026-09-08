import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASK_INTENTS,
  DEFAULT_INTENT,
  SUGGESTED_QUESTION_KEYS,
  SUGGESTION_INTENT,
  routeQuestion,
  type AskIntent,
} from "./intents.ts";

function route(q: string): AskIntent {
  return routeQuestion(q).intent;
}

test("English questions route to the expected intent", () => {
  assert.equal(route("Which leads need attention today?"), "needs_attention");
  assert.equal(route("Who should we follow up with first?"), "priority_leads");
  assert.equal(route("Which leads are at risk?"), "at_risk_leads");
  assert.equal(route("Which opportunities are closest to booking?"), "upcoming_appointments");
  assert.equal(route("What changed this week?"), "weekly_changes");
  assert.equal(route("Which recovery opportunities should we prioritize?"), "recovery_opportunities");
  assert.equal(route("Summarize today's sales activity."), "recent_activity");
  assert.equal(route("Give me a pipeline overview"), "pipeline_summary");
  assert.equal(route("Which follow-ups are overdue?"), "overdue_followups");
});

test("Arabic questions route to the expected intent", () => {
  assert.equal(route("أي العملاء يحتاجون انتباهًا اليوم؟"), "needs_attention");
  assert.equal(route("أي العملاء في خطر؟"), "at_risk_leads");
  assert.equal(route("أي الفرص الأقرب للحجز؟"), "upcoming_appointments");
  assert.equal(route("ما الذي تغيّر هذا الأسبوع؟"), "weekly_changes");
  assert.equal(route("لخّص نشاط اليوم"), "recent_activity");
  assert.equal(route("أي فرص الاستعادة يجب أن نعطيها الأولوية؟"), "recovery_opportunities");
});

test("Arabic matching is tashkeel- and alef-form-insensitive", () => {
  // "مُتابَعة" with harakat, "إعادة" with hamza
  assert.equal(route("ما المُتابَعات المتأخِّرة؟"), "overdue_followups");
  assert.equal(route("إعادة تفعيل العملاء المفقودين"), "recovery_opportunities");
});

test("an unrecognised or empty question falls back to the default intent", () => {
  const r1 = routeQuestion("hello there");
  assert.equal(r1.intent, DEFAULT_INTENT);
  assert.equal(r1.matched, false);
  assert.equal(routeQuestion("").intent, DEFAULT_INTENT);
  assert.equal(routeQuestion("   ").matched, false);
});

test("routeQuestion never throws and always returns an allowlisted intent", () => {
  for (const q of ["", "?", "🤔", "SELECT * FROM leads", "a".repeat(2000)]) {
    const r = routeQuestion(q);
    assert.ok(ASK_INTENTS.includes(r.intent), `${q} -> ${r.intent}`);
    assert.ok(r.score >= 0);
  }
});

test("a stronger keyword match wins over a weaker one", () => {
  // "at risk" + "losing" both hit at_risk_leads; only "week" hits weekly_changes
  assert.equal(route("are we losing any at-risk leads this week?"), "at_risk_leads");
});

test("every suggested question maps to an allowlisted intent", () => {
  for (const key of SUGGESTED_QUESTION_KEYS) {
    assert.ok(ASK_INTENTS.includes(SUGGESTION_INTENT[key]));
  }
});
