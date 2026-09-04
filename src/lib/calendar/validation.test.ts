import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAppointmentNote,
  normalizeCancelReason,
  validateSlotSelection,
} from "./validation.ts";

test("normalizeAppointmentNote trims, caps at 500, nulls empties/non-strings", () => {
  assert.equal(normalizeAppointmentNote("  hi  "), "hi");
  assert.equal(normalizeAppointmentNote(""), null);
  assert.equal(normalizeAppointmentNote("   "), null);
  assert.equal(normalizeAppointmentNote(42), null);
  assert.equal((normalizeAppointmentNote("x".repeat(999)) ?? "").length, 500);
});

test("normalizeCancelReason trims, caps at 200, nulls empties/non-strings", () => {
  assert.equal(normalizeCancelReason("  change of plans  "), "change of plans");
  assert.equal(normalizeCancelReason(""), null);
  assert.equal(normalizeCancelReason(null), null);
  assert.equal((normalizeCancelReason("x".repeat(999)) ?? "").length, 200);
});

test("validateSlotSelection: future ISO ok, past/junk/missing rejected", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  const ok = validateSlotSelection("2026-09-05T09:00:00Z", now);
  assert.equal(ok.ok, true);
  assert.equal(ok.iso, "2026-09-05T09:00:00.000Z");

  assert.equal(validateSlotSelection("", now).errorCode, "calendar.validation.slotRequired");
  assert.equal(validateSlotSelection(undefined, now).errorCode, "calendar.validation.slotRequired");
  assert.equal(validateSlotSelection("not-a-date", now).errorCode, "calendar.validation.slotInvalid");
  assert.equal(
    validateSlotSelection("2026-09-03T09:00:00Z", now).errorCode,
    "calendar.validation.slotPast",
  );
});
