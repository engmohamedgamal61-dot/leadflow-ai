import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeGoLiveReadiness,
  READINESS_CHECKS,
  READINESS_STATES,
  type ReadinessInput,
} from "./readiness.ts";

function baseInput(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    templateValid: true,
    hasCustomConfig: false,
    whatsappStatus: null,
    whatsappLastError: null,
    calendarStatus: null,
    calendarLastError: null,
    calendarWorkingDays: [],
    ...over,
  };
}

test("registries: exactly the required check + state vocabularies", () => {
  assert.deepEqual([...READINESS_CHECKS], ["aiAgent", "whatsapp", "calendar", "bookingHours"]);
  assert.deepEqual([...READINESS_STATES], ["ready", "attention", "pending"]);
});

test("a brand-new workspace: AI ready on defaults, everything else pending", () => {
  const r = computeGoLiveReadiness(baseInput());
  assert.equal(r.totalCount, 4);
  const byKey = Object.fromEntries(r.checks.map((c) => [c.key, c]));
  assert.equal(byKey.aiAgent.state, "ready");
  assert.equal(byKey.aiAgent.detailKey, "dashboard.readiness.detail.aiAgentDefaults");
  assert.equal(byKey.whatsapp.state, "pending");
  assert.equal(byKey.calendar.state, "pending");
  assert.equal(byKey.bookingHours.state, "pending");
  assert.equal(byKey.bookingHours.detailKey, "dashboard.readiness.detail.bookingHoursBlocked");
  assert.equal(r.readyCount, 1);
  assert.equal(r.allReady, false);
});

test("customized AI config shows the 'tuned' detail", () => {
  const r = computeGoLiveReadiness(baseInput({ hasCustomConfig: true }));
  const ai = r.checks.find((c) => c.key === "aiAgent")!;
  assert.equal(ai.state, "ready");
  assert.equal(ai.detailKey, "dashboard.readiness.detail.aiAgentCustom");
});

test("an invalid template flags the AI check for attention", () => {
  const r = computeGoLiveReadiness(baseInput({ templateValid: false }));
  const ai = r.checks.find((c) => c.key === "aiAgent")!;
  assert.equal(ai.state, "attention");
});

test("a connection in error state surfaces the last error", () => {
  const r = computeGoLiveReadiness(
    baseInput({ whatsappStatus: "error", whatsappLastError: "token expired" }),
  );
  const wa = r.checks.find((c) => c.key === "whatsapp")!;
  assert.equal(wa.state, "attention");
  assert.equal(wa.detailKey, "dashboard.readiness.detail.whatsappError");
  assert.equal(wa.detailParams?.error, "token expired");
});

test("booking hours is a real check only once the calendar is connected", () => {
  const blocked = computeGoLiveReadiness(baseInput({ calendarStatus: "pending" }));
  assert.equal(blocked.checks.find((c) => c.key === "bookingHours")!.state, "pending");
  assert.equal(
    blocked.checks.find((c) => c.key === "bookingHours")!.detailKey,
    "dashboard.readiness.detail.bookingHoursBlocked",
  );

  const set = computeGoLiveReadiness(
    baseInput({ calendarStatus: "connected", calendarWorkingDays: [0, 1, 2, 3, 4] }),
  );
  const hours = set.checks.find((c) => c.key === "bookingHours")!;
  assert.equal(hours.state, "ready");
  assert.equal(hours.detailParams?.days, 5);
});

test("calendar connected but no working days configured → attention", () => {
  const r = computeGoLiveReadiness(
    baseInput({ calendarStatus: "connected", calendarWorkingDays: [] }),
  );
  assert.equal(r.checks.find((c) => c.key === "bookingHours")!.state, "attention");
});

test("a fully wired workspace is all-ready", () => {
  const r = computeGoLiveReadiness(
    baseInput({
      hasCustomConfig: true,
      whatsappStatus: "connected",
      calendarStatus: "connected",
      calendarWorkingDays: [1, 2, 3, 4, 5],
    }),
  );
  assert.equal(r.readyCount, 4);
  assert.equal(r.totalCount, 4);
  assert.equal(r.allReady, true);
});

test("no industry branching: readiness has no industry/template-name field to branch on", () => {
  const keys = Object.keys(baseInput());
  assert.ok(!keys.some((k) => /industry|templateName|templateId/i.test(k)));
});
