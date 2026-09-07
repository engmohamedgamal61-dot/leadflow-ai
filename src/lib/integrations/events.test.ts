import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATION_EVENT_TYPES,
  INTEGRATION_EVENT_GROUPS,
  isIntegrationEventType,
  parseSubscribedEvents,
} from "./events.ts";

test("the 10 spec events are all present", () => {
  assert.deepEqual(
    [...INTEGRATION_EVENT_TYPES].sort(),
    [
      "appointment.booked",
      "appointment.cancelled",
      "appointment.rescheduled",
      "follow_up.executed",
      "handoff.requested",
      "lead.created",
      "lead.qualified",
      "lead.status_changed",
      "recovery.resolved",
      "recovery.started",
    ],
  );
});

test("every grouped event is a real event type and vice versa", () => {
  const grouped = INTEGRATION_EVENT_GROUPS.flatMap((g) => g.events).sort();
  assert.deepEqual(grouped, [...INTEGRATION_EVENT_TYPES].sort());
});

test("isIntegrationEventType is strict", () => {
  assert.equal(isIntegrationEventType("lead.qualified"), true);
  assert.equal(isIntegrationEventType("lead_qualified"), false);
  assert.equal(isIntegrationEventType(42), false);
});

test("parseSubscribedEvents drops unknowns, de-dupes, sorts canonically", () => {
  assert.deepEqual(
    parseSubscribedEvents([
      "recovery.started",
      "lead.created",
      "lead.created",
      "nope",
      42,
    ]),
    ["lead.created", "recovery.started"],
  );
  assert.deepEqual(parseSubscribedEvents("not-array" as unknown), []);
});
