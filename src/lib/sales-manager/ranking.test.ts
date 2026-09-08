import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_LIMIT,
  filterByRisk,
  isEmptyResult,
  pipelineMetrics,
  rankPriorityLeads,
  rankRecovery,
  shapeAppointments,
  shapeOverdueFollowUps,
  weeklyChangeMetrics,
  type InsightCandidate,
  type RecoveryCandidateLike,
} from "./ranking.ts";

function cand(
  id: string,
  risk: "needs_attention" | "at_risk" | "none",
  score: number,
  updatedAt = "2026-09-01T00:00:00Z",
  reasonKey = "insights.reasons.onTrack",
): InsightCandidate {
  return {
    lead: { id, name: `Lead ${id}`, status: "qualified", temperature: "warm", score, updatedAt },
    insight: { riskLevel: risk, action: risk === "none" ? "none" : "call_now", reasonKey },
  };
}

test("priority ranking: needs_attention before at_risk before others", () => {
  const cards = rankPriorityLeads([
    cand("a", "none", 90),
    cand("b", "at_risk", 40),
    cand("c", "needs_attention", 10),
  ]);
  assert.deepEqual(cards.map((c) => c.id), ["c", "b"]);
});

test("priority ranking: within a band, higher score first, then most-neglected", () => {
  const cards = rankPriorityLeads([
    cand("low-old", "needs_attention", 20, "2026-01-01T00:00:00Z"),
    cand("high", "needs_attention", 80, "2026-09-01T00:00:00Z"),
    cand("low-new", "needs_attention", 20, "2026-09-05T00:00:00Z"),
  ]);
  assert.deepEqual(cards.map((c) => c.id), ["high", "low-old", "low-new"]);
});

test("priority ranking drops 'none' risk leads and caps at CARD_LIMIT", () => {
  const many = Array.from({ length: 20 }, (_, i) => cand(`n${i}`, "needs_attention", i));
  many.push(cand("skip", "none", 100));
  const cards = rankPriorityLeads(many);
  assert.equal(cards.length, CARD_LIMIT);
  assert.ok(!cards.some((c) => c.id === "skip"));
});

test("filterByRisk returns only the requested band", () => {
  const input = [cand("a", "needs_attention", 10), cand("b", "at_risk", 10), cand("c", "none", 10)];
  assert.deepEqual(filterByRisk(input, "at_risk").map((c) => c.id), ["b"]);
  assert.deepEqual(filterByRisk(input, "needs_attention").map((c) => c.id), ["a"]);
});

test("lead cards carry the reason key + a link, never a raw id in the label", () => {
  const [card] = rankPriorityLeads([cand("x", "needs_attention", 50, undefined, "insights.reasons.unansweredInbound")]);
  assert.equal(card.reasonKey, "insights.reasons.unansweredInbound");
  assert.equal(card.href, "/dashboard/leads/x");
  assert.equal(card.tag, "call_now");
});

test("recovery ranking orders by priority then neglect", () => {
  const mk = (id: string, priority: "high" | "medium" | "low"): RecoveryCandidateLike => ({
    lead: { id, name: id, status: "lost", temperature: "cold", score: 0, updatedAt: "2026-05-01T00:00:00Z" },
    candidate: { priority, reasonKey: "recovery.reasons.lostGeneral" },
  });
  const cards = rankRecovery([mk("m", "medium"), mk("h", "high"), mk("l", "low")]);
  assert.deepEqual(cards.map((c) => c.id), ["h", "m", "l"]);
  assert.equal(cards[0].tag, "high");
});

test("appointments are sorted soonest-first and linked to the lead", () => {
  const cards = shapeAppointments([
    { id: "2", leadId: "l2", leadName: "B", startsAt: "2026-09-10T10:00:00Z", status: "scheduled" },
    { id: "1", leadId: "l1", leadName: "A", startsAt: "2026-09-09T10:00:00Z", status: "scheduled" },
  ]);
  assert.deepEqual(cards.map((c) => c.id), ["1", "2"]);
  assert.equal(cards[0].href, "/dashboard/leads/l1");
});

test("overdue follow-ups: overdue first, then failed, with counts", () => {
  const { cards, overdueCount, failedCount } = shapeOverdueFollowUps([
    { id: "f1", leadId: "l1", leadName: "A", scheduledAt: "2026-09-02T00:00:00Z", status: "pending", overdue: true },
    { id: "f2", leadId: "l2", leadName: "B", scheduledAt: "2026-09-01T00:00:00Z", status: "failed", overdue: false },
    { id: "f3", leadId: "l3", leadName: "C", scheduledAt: "2026-09-05T00:00:00Z", status: "pending", overdue: false },
  ]);
  assert.equal(overdueCount, 1);
  assert.equal(failedCount, 1);
  assert.deepEqual(cards.map((c) => c.id), ["l2", "l1"]); // sorted by scheduledAt within the overdue+failed set
  assert.equal(cards.find((c) => c.id === "l1")?.reasonKey, "askLeadFlow.reasons.followUpOverdue");
  assert.equal(cards.find((c) => c.id === "l2")?.reasonKey, "askLeadFlow.reasons.followUpFailed");
});

test("pipeline metrics reflect the inputs", () => {
  const m = pipelineMetrics({
    stats: { total: 12, hot: 3, warm: 5, cold: 4, qualified: 6, won: 2, createdToday: 1 },
    insightSummary: { needsAttention: 4, atRisk: 2, noActionNeeded: 6 },
    followUpCounts: { pending: 5, dueNow: 3, failed: 1 },
    upcomingAppointments: 2,
    recoveryOpportunities: 7,
  });
  const byKey = Object.fromEntries(m.map((x) => [x.key, x.value]));
  assert.equal(byKey.totalLeads, 12);
  assert.equal(byKey.needsAttention, 4);
  assert.equal(byKey.followUpsDue, 3);
  assert.equal(byKey.recoveryOpportunities, 7);
});

test("weekly-change metrics carry a signed delta", () => {
  const m = weeklyChangeMetrics({
    leads: { current: 10, previous: 6 },
    qualified: { current: 3, previous: 5 },
    appointments: { current: 2, previous: 2 },
  });
  const byKey = Object.fromEntries(m.map((x) => [x.key, x]));
  assert.equal(byKey.newLeads.delta, 4);
  assert.equal(byKey.qualified.delta, -2);
  assert.equal(byKey.appointmentsBooked.delta, 0);
});

test("isEmptyResult is true only when nothing is worth an AI answer", () => {
  assert.equal(
    isEmptyResult({ intent: "priority_leads", metrics: [], leads: [], appointments: [], activity: [] }),
    true,
  );
  assert.equal(
    isEmptyResult({
      intent: "pipeline_summary",
      metrics: [{ key: "totalLeads", value: 0 }, { key: "hot", value: 0 }],
      leads: [],
      appointments: [],
      activity: [],
    }),
    true,
  );
  assert.equal(
    isEmptyResult({
      intent: "pipeline_summary",
      metrics: [{ key: "totalLeads", value: 3 }],
      leads: [],
      appointments: [],
      activity: [],
    }),
    false,
  );
  assert.equal(
    isEmptyResult({
      intent: "priority_leads",
      metrics: [],
      leads: [rankPriorityLeads([cand("a", "needs_attention", 1)])[0]],
      appointments: [],
      activity: [],
    }),
    false,
  );
});
