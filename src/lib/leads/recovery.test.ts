import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRecoveryCandidate,
  computeRecoveryAttemptOutcome,
  resolveRecoveryChannel,
  RECOVERY_PRIORITIES,
  RECOVERY_OUTCOMES,
  RECOVERY_INACTIVITY_DAYS,
  RECOVERY_COLD_INACTIVITY_DAYS,
  RECOVERY_REATTEMPT_COOLDOWN_DAYS,
  RECOVERY_NO_RESPONSE_DAYS,
  type RecoverySignals,
  type RecoveryAttemptSignals,
} from "./recovery.ts";

const NOW = new Date("2026-09-10T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function baseSignals(over: Partial<RecoverySignals> = {}): RecoverySignals {
  return {
    status: "contacted",
    temperature: "WARM",
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
    lastInboundAt: daysAgo(20),
    lastOutboundAt: daysAgo(20),
    hasPendingFollowUp: false,
    hasActiveAppointment: false,
    hasOpenRecoveryAttempt: false,
    lastRecoveryResolvedAt: null,
    ...over,
  };
}

test("registries: exactly the required priority + outcome vocabularies", () => {
  assert.deepEqual([...RECOVERY_PRIORITIES], ["high", "medium", "low"]);
  assert.deepEqual(
    [...RECOVERY_OUTCOMES],
    ["pending", "contacted", "recovered", "converted", "no_response"],
  );
});

test("won and archived leads are never recovery candidates", () => {
  for (const status of ["won", "archived"]) {
    const candidate = computeRecoveryCandidate(
      baseSignals({ status, updatedAt: daysAgo(90), temperature: "HOT" }),
      NOW,
    );
    assert.equal(candidate, null);
  }
});

test("a lead with an open recovery attempt is never a duplicate candidate", () => {
  const candidate = computeRecoveryCandidate(
    baseSignals({ status: "lost", hasOpenRecoveryAttempt: true }),
    NOW,
  );
  assert.equal(candidate, null);
});

test("a lead with a pending follow-up or an active appointment is not a candidate", () => {
  assert.equal(
    computeRecoveryCandidate(baseSignals({ status: "lost", hasPendingFollowUp: true }), NOW),
    null,
  );
  assert.equal(
    computeRecoveryCandidate(baseSignals({ status: "lost", hasActiveAppointment: true }), NOW),
    null,
  );
});

test("explicitly lost + HOT → high priority", () => {
  const candidate = computeRecoveryCandidate(
    baseSignals({ status: "lost", temperature: "HOT" }),
    NOW,
  );
  assert.equal(candidate?.priority, "high");
  assert.equal(candidate?.reasonKey, "recovery.reasons.lostHot");
});

test("explicitly lost + WARM/COLD → medium priority", () => {
  for (const temperature of ["WARM", "COLD"] as const) {
    const candidate = computeRecoveryCandidate(baseSignals({ status: "lost", temperature }), NOW);
    assert.equal(candidate?.priority, "medium");
    assert.equal(candidate?.reasonKey, "recovery.reasons.lostGeneral");
  }
});

test("lost is a candidate regardless of recency (no inactivity threshold applies)", () => {
  const candidate = computeRecoveryCandidate(
    baseSignals({ status: "lost", updatedAt: daysAgo(1), lastInboundAt: daysAgo(1), lastOutboundAt: daysAgo(1) }),
    NOW,
  );
  assert.ok(candidate);
});

test("inactive qualified lead (>= threshold days silent) → high priority", () => {
  const candidate = computeRecoveryCandidate(
    baseSignals({
      status: "qualified",
      updatedAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 1),
      lastInboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 1),
      lastOutboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 1),
    }),
    NOW,
  );
  assert.equal(candidate?.priority, "high");
  assert.equal(candidate?.reasonKey, "recovery.reasons.inactiveQualified");
  assert.ok((candidate?.reasonParams?.days as number) >= RECOVERY_INACTIVITY_DAYS);
});

test("qualified lead inactive for less than the threshold is not yet a candidate", () => {
  const candidate = computeRecoveryCandidate(
    baseSignals({
      status: "qualified",
      updatedAt: daysAgo(RECOVERY_INACTIVITY_DAYS - 1),
      lastInboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS - 1),
      lastOutboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS - 1),
    }),
    NOW,
  );
  assert.equal(candidate, null);
});

test("appointment status with no active appointment, long inactive → high priority (like qualified)", () => {
  const candidate = computeRecoveryCandidate(
    baseSignals({
      status: "appointment",
      hasActiveAppointment: false,
      updatedAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 5),
      lastInboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 5),
      lastOutboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 5),
    }),
    NOW,
  );
  assert.equal(candidate?.priority, "high");
});

test("warm/hot new-or-contacted lead inactive for the threshold → medium priority", () => {
  for (const status of ["new", "contacted"]) {
    const candidate = computeRecoveryCandidate(
      baseSignals({
        status,
        temperature: "WARM",
        updatedAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 1),
        lastInboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 1),
        lastOutboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 1),
      }),
      NOW,
    );
    assert.equal(candidate?.priority, "medium");
    assert.equal(candidate?.reasonKey, "recovery.reasons.inactiveWarm");
  }
});

test("cold new/contacted lead needs the longer cold-inactivity threshold, not the short one", () => {
  const tooSoon = computeRecoveryCandidate(
    baseSignals({
      status: "new",
      temperature: "COLD",
      updatedAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 1),
      lastInboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 1),
      lastOutboundAt: daysAgo(RECOVERY_INACTIVITY_DAYS + 1),
    }),
    NOW,
  );
  assert.equal(tooSoon, null);

  const longEnough = computeRecoveryCandidate(
    baseSignals({
      status: "new",
      temperature: "COLD",
      updatedAt: daysAgo(RECOVERY_COLD_INACTIVITY_DAYS + 1),
      lastInboundAt: daysAgo(RECOVERY_COLD_INACTIVITY_DAYS + 1),
      lastOutboundAt: daysAgo(RECOVERY_COLD_INACTIVITY_DAYS + 1),
    }),
    NOW,
  );
  assert.equal(longEnough?.priority, "low");
  assert.equal(longEnough?.reasonKey, "recovery.reasons.inactiveCold");
});

test("recently active lead (below every threshold) is not a candidate", () => {
  const candidate = computeRecoveryCandidate(
    baseSignals({
      status: "contacted",
      temperature: "WARM",
      updatedAt: daysAgo(1),
      lastInboundAt: daysAgo(1),
      lastOutboundAt: daysAgo(1),
    }),
    NOW,
  );
  assert.equal(candidate, null);
});

test("a lead whose last recovery attempt resolved recently is in cooldown", () => {
  const stillCoolingDown = computeRecoveryCandidate(
    baseSignals({
      status: "lost",
      lastRecoveryResolvedAt: daysAgo(RECOVERY_REATTEMPT_COOLDOWN_DAYS - 1),
    }),
    NOW,
  );
  assert.equal(stillCoolingDown, null);

  const cooldownExpired = computeRecoveryCandidate(
    baseSignals({
      status: "lost",
      lastRecoveryResolvedAt: daysAgo(RECOVERY_REATTEMPT_COOLDOWN_DAYS + 1),
    }),
    NOW,
  );
  assert.ok(cooldownExpired);
});

test("real estate and clinic leads with identical signals get identical candidates (no industry branching)", () => {
  const realEstate = baseSignals({ status: "qualified", updatedAt: daysAgo(20), lastInboundAt: daysAgo(20), lastOutboundAt: daysAgo(20) });
  const clinic = baseSignals({ status: "qualified", updatedAt: daysAgo(20), lastInboundAt: daysAgo(20), lastOutboundAt: daysAgo(20) });
  assert.deepEqual(computeRecoveryCandidate(realEstate, NOW), computeRecoveryCandidate(clinic, NOW));

  const keys = Object.keys(realEstate);
  assert.ok(!keys.some((k) => /industry|template/i.test(k)));
});

// ── computeRecoveryAttemptOutcome ───────────────────────────────────────────

function baseAttempt(over: Partial<RecoveryAttemptSignals> = {}): RecoveryAttemptSignals {
  return {
    leadStatus: "contacted",
    followUpStatus: "pending",
    followUpCompletedAt: null,
    lastInboundAt: null,
    resolvedAs: null,
    ...over,
  };
}

test("attempt outcome: pending while the follow-up hasn't run yet", () => {
  assert.equal(computeRecoveryAttemptOutcome(baseAttempt(), NOW), "pending");
});

test("attempt outcome: contacted once the follow-up is delivered", () => {
  assert.equal(
    computeRecoveryAttemptOutcome(
      baseAttempt({ followUpStatus: "completed", followUpCompletedAt: daysAgo(1) }),
      NOW,
    ),
    "contacted",
  );
});

test("attempt outcome: recovered when the lead replies after being contacted", () => {
  assert.equal(
    computeRecoveryAttemptOutcome(
      baseAttempt({
        followUpStatus: "completed",
        followUpCompletedAt: daysAgo(2),
        lastInboundAt: daysAgo(1),
      }),
      NOW,
    ),
    "recovered",
  );
});

test("attempt outcome: an inbound message BEFORE contact doesn't count as recovered", () => {
  assert.equal(
    computeRecoveryAttemptOutcome(
      baseAttempt({
        followUpStatus: "completed",
        followUpCompletedAt: daysAgo(1),
        lastInboundAt: daysAgo(5),
      }),
      NOW,
    ),
    "contacted",
  );
});

test("attempt outcome: no_response after the silence window with no reply", () => {
  assert.equal(
    computeRecoveryAttemptOutcome(
      baseAttempt({
        followUpStatus: "completed",
        followUpCompletedAt: daysAgo(RECOVERY_NO_RESPONSE_DAYS + 1),
      }),
      NOW,
    ),
    "no_response",
  );
});

test("attempt outcome: delivery failure or cancellation is immediately no_response", () => {
  for (const followUpStatus of ["failed", "cancelled"]) {
    assert.equal(computeRecoveryAttemptOutcome(baseAttempt({ followUpStatus }), NOW), "no_response");
  }
});

test("attempt outcome: the lead becoming won is always converted, regardless of follow-up state", () => {
  assert.equal(
    computeRecoveryAttemptOutcome(baseAttempt({ leadStatus: "won", followUpStatus: "pending" }), NOW),
    "converted",
  );
});

test("attempt outcome: a manually resolved outcome always wins", () => {
  assert.equal(
    computeRecoveryAttemptOutcome(
      baseAttempt({ followUpStatus: "completed", resolvedAs: "no_response" }),
      NOW,
    ),
    "no_response",
  );
  assert.equal(
    computeRecoveryAttemptOutcome(baseAttempt({ resolvedAs: "converted" }), NOW),
    "converted",
  );
});

// ── resolveRecoveryChannel ───────────────────────────────────────────────────

test("resolveRecoveryChannel: whatsapp when the lead has a phone, internal otherwise", () => {
  assert.equal(resolveRecoveryChannel({ phone: "+966500000000" }), "whatsapp");
  assert.equal(resolveRecoveryChannel({ phone: null }), "internal");
  assert.equal(resolveRecoveryChannel({ phone: "  " }), "internal");
});
