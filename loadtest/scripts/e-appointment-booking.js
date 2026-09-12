// Scenario E — Appointment booking, through the real AI-executed path: a
// chat turn whose extraction proposes `book_appointment` for a slot named via
// the mock's BOOK_SLOT:<iso> trigger (anthropic-mock-server.mjs) — this
// exercises the REAL bookAppointment() in src/lib/calendar/service.ts: the
// live-availability soft check, the DB exclusion-constraint hard guard, and
// the idempotent-retry path, exactly as a real AI-driven booking would.
//
// "availability" is not isolated here — every /api/chat call already fetches
// it for the system prompt (see Scenario B); there is no standalone REST
// availability endpoint (the dashboard's manual-booking form is a Server
// Action — same wire-protocol limitation noted in d-dashboard.js).
//
// Two groups:
//   different_slots      — each VU books its OWN unique slot for ORG 0.
//     Expect: all succeed, no contention.
//   concurrent_same_slot — every VU in this group books the SAME slot for
//     ORG 1, as close to simultaneously as k6's shared-iterations executor
//     can start them. Expect: exactly one appointment ends up in the DB for
//     that org+slot; every other attempt returns a graceful
//     "errors.calendar.slotTaken" outcome, never a 500 and never a second row
//     — verified post-run against the real DB (see loadtest/README.md).
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";
import { APP_URL, WIDGET_ORIGIN, orgs, syntheticIp } from "./lib/config.js";

export const bookingExecuted = new Counter("booking_executed");
export const bookingSlotTaken = new Counter("booking_slot_taken");
export const bookingOtherOutcome = new Counter("booking_other_outcome");
export const errorRate = new Rate("scenario_errors");

// Must stay within APPOINTMENT_MAX_DAYS (60, src/lib/agent/actions.ts) of
// "now" or parseProposedActions silently drops the action (actions: []) —
// the real, correct sanity-bound behavior, not a bug (an earlier hardcoded
// 2027 literal here tripped exactly this and made every booking a no-op).
function daysFromNow(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
const SAME_SLOT_ISO = __ENV.SAME_SLOT_ISO || daysFromNow(10);

export const options = {
  scenarios: {
    different_slots: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS_DIFFERENT || 10),
      iterations: Number(__ENV.VUS_DIFFERENT || 10),
      maxDuration: "60s",
      exec: "differentSlots",
    },
    concurrent_same_slot: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS_SAME_SLOT || 20),
      iterations: Number(__ENV.VUS_SAME_SLOT || 20),
      maxDuration: "60s",
      exec: "concurrentSameSlot",
      startTime: "5s",
    },
  },
  thresholds: { scenario_errors: ["rate<0.05"] },
};

function bookTurn(org, ip, slotIso) {
  const res = http.post(
    `${APP_URL}/api/chat`,
    JSON.stringify({
      messages: [{ role: "user", content: `I'd like to book. BOOK_SLOT:${slotIso}` }],
      widgetKey: org.widgetKey,
      pageOrigin: WIDGET_ORIGIN,
    }),
    {
      headers: { "Content-Type": "application/json", Origin: WIDGET_ORIGIN, "x-loadtest-client-ip": ip },
      timeout: "60s",
    },
  );
  const ok = check(res, { "booking turn: 200": (r) => r.status === 200 });
  errorRate.add(!ok);
  if (ok) {
    if (res.body.includes('"status":"executed"')) bookingExecuted.add(1);
    else if (res.body.includes("slotTaken")) bookingSlotTaken.add(1);
    else bookingOtherOutcome.add(1);
  }
  return res;
}

export function differentSlots() {
  const org = orgs[0];
  // Spread bookings a day apart (within the 60-day window) so none collide —
  // each VU's own unique slot.
  const slot = daysFromNow(3 + (__VU % 40));
  bookTurn(org, syntheticIp(__VU), slot);
  sleep(0.5);
}

export function concurrentSameSlot() {
  const org = orgs[1] || orgs[0];
  bookTurn(org, syntheticIp(2000 + __VU), SAME_SLOT_ISO);
}
