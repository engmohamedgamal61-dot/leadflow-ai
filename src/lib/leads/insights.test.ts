import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeLeadInsight,
  buildInsightSignals,
  NEXT_BEST_ACTIONS,
  RISK_LEVELS,
  UNANSWERED_INBOUND_MINUTES,
  HOT_STALE_HOURS,
  INACTIVE_QUALIFIED_DAYS,
  APPOINTMENT_RECOVERY_DAYS,
  type LeadInsightSignals,
} from "./insights.ts";

const NOW = new Date("2026-09-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function baseSignals(over: Partial<LeadInsightSignals> = {}): LeadInsightSignals {
  return {
    status: "contacted",
    temperature: "WARM",
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    lastInboundAt: hoursAgo(1),
    lastOutboundAt: hoursAgo(1),
    lastMessageIsInbound: false,
    handoffPending: false,
    pendingFollowUps: [],
    activeAppointment: null,
    lastCancelledAppointment: null,
    ...over,
  };
}

test("registries: exactly the required action + risk vocabularies", () => {
  assert.deepEqual([...NEXT_BEST_ACTIONS], [
    "call_now",
    "follow_up",
    "reply_now",
    "book_appointment",
    "human_handoff",
    "recover_lead",
    "none",
  ]);
  assert.deepEqual([...RISK_LEVELS], ["needs_attention", "at_risk", "none"]);
});

test("closed lifecycle (won/lost/archived) always needs no action, regardless of other signals", () => {
  for (const status of ["won", "lost", "archived"]) {
    const insight = computeLeadInsight(
      baseSignals({ status, temperature: "HOT", handoffPending: true, updatedAt: daysAgo(30) }),
    );
    assert.equal(insight.riskLevel, "none");
    assert.equal(insight.action, "none");
    assert.equal(insight.reasonKey, "insights.reasons.closed");
  }
});

test("unanswered inbound message → needs_attention / reply_now", () => {
  const signals = baseSignals({
    lastMessageIsInbound: true,
    lastInboundAt: hoursAgo(1), // 60 min > UNANSWERED_INBOUND_MINUTES
    lastOutboundAt: hoursAgo(5),
  });
  const insight = computeLeadInsight(signals, NOW);
  assert.equal(insight.riskLevel, "needs_attention");
  assert.equal(insight.action, "reply_now");
  assert.equal(insight.reasonKey, "insights.reasons.unansweredInbound");
  assert.equal(insight.reasonParams?.minutes, 60);
});

test("a very recent inbound message is not yet flagged (below the threshold)", () => {
  const insight = computeLeadInsight(
    baseSignals({
      lastMessageIsInbound: true,
      lastInboundAt: new Date(NOW.getTime() - (UNANSWERED_INBOUND_MINUTES / 2) * 60_000).toISOString(),
    }),
    NOW,
  );
  assert.notEqual(insight.action, "reply_now");
});

test("pending human handoff (no reply since) → needs_attention / human_handoff", () => {
  const insight = computeLeadInsight(
    baseSignals({ handoffPending: true, lastMessageIsInbound: false, lastInboundAt: hoursAgo(3) }),
    NOW,
  );
  assert.equal(insight.riskLevel, "needs_attention");
  assert.equal(insight.action, "human_handoff");
  assert.equal(insight.reasonKey, "insights.reasons.handoffPending");
});

test("unanswered inbound outranks a pending handoff (checked first)", () => {
  const insight = computeLeadInsight(
    baseSignals({
      lastMessageIsInbound: true,
      lastInboundAt: hoursAgo(2),
      handoffPending: true,
    }),
    NOW,
  );
  assert.equal(insight.action, "reply_now");
});

test("overdue follow-up → needs_attention / follow_up, with days-overdue", () => {
  const insight = computeLeadInsight(
    baseSignals({ pendingFollowUps: [{ scheduledAt: daysAgo(2) }] }),
    NOW,
  );
  assert.equal(insight.riskLevel, "needs_attention");
  assert.equal(insight.action, "follow_up");
  assert.equal(insight.reasonKey, "insights.reasons.followUpOverdue");
  assert.equal(insight.reasonParams?.days, 2);
});

test("a future-scheduled follow-up is not overdue", () => {
  const insight = computeLeadInsight(
    baseSignals({ pendingFollowUps: [{ scheduledAt: hoursFromNow(5) }] }),
    NOW,
  );
  assert.notEqual(insight.action, "follow_up");
  assert.equal(insight.riskLevel, "none");
  assert.equal(insight.reasonKey, "insights.reasons.followUpScheduled");
});

test("missed appointment (booked time already passed) → at_risk / recover_lead", () => {
  const insight = computeLeadInsight(
    baseSignals({ activeAppointment: { startsAt: hoursAgo(3) } }),
    NOW,
  );
  assert.equal(insight.riskLevel, "at_risk");
  assert.equal(insight.action, "recover_lead");
  assert.equal(insight.reasonKey, "insights.reasons.appointmentMissed");
});

test("an upcoming (not yet started) appointment is on track, not a risk", () => {
  const insight = computeLeadInsight(
    baseSignals({
      status: "appointment",
      temperature: "HOT",
      updatedAt: daysAgo(10), // would otherwise trip the hot-stale rule
      activeAppointment: { startsAt: hoursFromNow(5) },
    }),
    NOW,
  );
  assert.equal(insight.riskLevel, "none");
  assert.equal(insight.action, "none");
  assert.equal(insight.reasonKey, "insights.reasons.appointmentUpcoming");
});

test("cancelled appointment within the recovery window, nothing re-booked → at_risk / recover_lead", () => {
  const insight = computeLeadInsight(
    baseSignals({ lastCancelledAppointment: { updatedAt: daysAgo(2) } }),
    NOW,
  );
  assert.equal(insight.riskLevel, "at_risk");
  assert.equal(insight.action, "recover_lead");
  assert.equal(insight.reasonKey, "insights.reasons.appointmentCancelled");
  assert.equal(insight.reasonParams?.days, 2);
});

test("a cancelled appointment outside the recovery window is no longer actionable", () => {
  const insight = computeLeadInsight(
    baseSignals({
      lastCancelledAppointment: { updatedAt: daysAgo(APPOINTMENT_RECOVERY_DAYS + 5) },
      updatedAt: daysAgo(APPOINTMENT_RECOVERY_DAYS + 5),
    }),
    NOW,
  );
  assert.notEqual(insight.reasonKey, "insights.reasons.appointmentCancelled");
});

test("hot lead with no recent activity → at_risk / call_now", () => {
  const insight = computeLeadInsight(
    baseSignals({
      temperature: "HOT",
      lastInboundAt: daysAgo(2),
      lastOutboundAt: daysAgo(2),
      updatedAt: daysAgo(2),
    }),
    NOW,
  );
  assert.equal(insight.riskLevel, "at_risk");
  assert.equal(insight.action, "call_now");
  assert.equal(insight.reasonKey, "insights.reasons.hotLeadStale");
  assert.ok((insight.reasonParams?.hours as number) >= HOT_STALE_HOURS);
});

test("hot lead active within the stale window is not flagged", () => {
  const insight = computeLeadInsight(
    baseSignals({
      temperature: "HOT",
      lastInboundAt: hoursAgo(1),
      lastOutboundAt: hoursAgo(1),
      updatedAt: hoursAgo(1),
    }),
    NOW,
  );
  assert.notEqual(insight.action, "call_now");
});

test("inactive qualified lead with nothing planned → at_risk / book_appointment", () => {
  const insight = computeLeadInsight(
    baseSignals({
      status: "qualified",
      temperature: "WARM",
      lastInboundAt: daysAgo(INACTIVE_QUALIFIED_DAYS + 1),
      lastOutboundAt: daysAgo(INACTIVE_QUALIFIED_DAYS + 1),
      updatedAt: daysAgo(INACTIVE_QUALIFIED_DAYS + 1),
    }),
    NOW,
  );
  assert.equal(insight.riskLevel, "at_risk");
  assert.equal(insight.action, "book_appointment");
  assert.equal(insight.reasonKey, "insights.reasons.qualifiedInactive");
});

test("no-action case: recently active, nothing overdue, nothing to flag", () => {
  const insight = computeLeadInsight(
    baseSignals({
      status: "new",
      temperature: "COLD",
      lastInboundAt: hoursAgo(1),
      lastOutboundAt: hoursAgo(1),
      updatedAt: hoursAgo(1),
    }),
    NOW,
  );
  assert.equal(insight.riskLevel, "none");
  assert.equal(insight.action, "none");
  assert.equal(insight.reasonKey, "insights.reasons.onTrack");
});

test("real estate and clinic leads with identical signals get identical insights (no industry branching)", () => {
  // The engine only ever sees status/temperature/timestamps — never a
  // template or custom field — so two leads from different industries with
  // the same signals must produce the exact same recommendation.
  const realEstateSignals = baseSignals({
    status: "qualified",
    pendingFollowUps: [{ scheduledAt: daysAgo(1) }],
  });
  const clinicSignals = baseSignals({
    status: "qualified",
    pendingFollowUps: [{ scheduledAt: daysAgo(1) }],
  });
  assert.deepEqual(computeLeadInsight(realEstateSignals, NOW), computeLeadInsight(clinicSignals, NOW));

  // Sanity: LeadInsightSignals literally has no industry/template field to
  // branch on — this is enforced structurally, not just by this test.
  const keys = Object.keys(realEstateSignals);
  assert.ok(!keys.some((k) => /industry|template/i.test(k)));
});

test("buildInsightSignals derives lastInbound/lastOutbound/lastMessageIsInbound from message history", () => {
  const signals = buildInsightSignals({
    lead: { status: "contacted", temperature: "WARM", createdAt: daysAgo(3), updatedAt: hoursAgo(1) },
    messages: [
      { role: "assistant", createdAt: daysAgo(1) },
      { role: "user", createdAt: hoursAgo(2) },
      { role: "assistant", createdAt: hoursAgo(1) },
    ],
    events: [],
    followUps: [],
    appointments: [],
  });
  assert.equal(signals.lastInboundAt, hoursAgo(2));
  assert.equal(signals.lastOutboundAt, hoursAgo(1));
  assert.equal(signals.lastMessageIsInbound, false); // last message overall was the assistant's
});

test("buildInsightSignals: handoff is pending only while nothing was sent since", () => {
  const pending = buildInsightSignals({
    lead: { status: "contacted", temperature: "WARM", createdAt: daysAgo(3), updatedAt: hoursAgo(2) },
    messages: [{ role: "user", createdAt: hoursAgo(3) }],
    events: [{ eventType: "human_handoff_requested", createdAt: hoursAgo(2) }],
    followUps: [],
    appointments: [],
  });
  assert.equal(pending.handoffPending, true);

  const resolved = buildInsightSignals({
    lead: { status: "contacted", temperature: "WARM", createdAt: daysAgo(3), updatedAt: hoursAgo(1) },
    messages: [
      { role: "user", createdAt: hoursAgo(3) },
      { role: "assistant", createdAt: hoursAgo(1) }, // replied after the handoff request
    ],
    events: [{ eventType: "human_handoff_requested", createdAt: hoursAgo(2) }],
    followUps: [],
    appointments: [],
  });
  assert.equal(resolved.handoffPending, false);
});

test("buildInsightSignals: active vs cancelled appointments are separated correctly", () => {
  const signals = buildInsightSignals({
    lead: { status: "appointment", temperature: "HOT", createdAt: daysAgo(3), updatedAt: hoursAgo(1) },
    messages: [],
    events: [],
    followUps: [],
    appointments: [
      { status: "cancelled", startsAt: daysAgo(5), updatedAt: daysAgo(4) },
      { status: "scheduled", startsAt: hoursFromNow(10), updatedAt: hoursAgo(1) },
    ],
  });
  assert.equal(signals.activeAppointment?.startsAt, hoursFromNow(10));
  assert.equal(signals.lastCancelledAppointment?.updatedAt, daysAgo(4));
});
