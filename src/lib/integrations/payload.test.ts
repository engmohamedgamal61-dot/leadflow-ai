import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeliveryEnvelope, serializeEnvelope } from "./payload.ts";

const base = {
  eventId: "evt_1",
  type: "lead.qualified" as const,
  occurredAt: "2026-09-07T10:00:00.000Z",
  organizationId: "org_1",
  data: { lead: { id: "l1", score: 80 } },
};

test("buildDeliveryEnvelope shapes the public contract", () => {
  const env = buildDeliveryEnvelope(base);
  assert.deepEqual(env, {
    id: "evt_1",
    type: "lead.qualified",
    occurred_at: "2026-09-07T10:00:00.000Z",
    organization_id: "org_1",
    data: { lead: { id: "l1", score: 80 } },
  });
});

test("serializeEnvelope is deterministic regardless of build-input key order", () => {
  const a = serializeEnvelope(buildDeliveryEnvelope(base));
  const b = serializeEnvelope(
    buildDeliveryEnvelope({
      data: base.data,
      organizationId: base.organizationId,
      occurredAt: base.occurredAt,
      type: base.type,
      eventId: base.eventId,
    }),
  );
  assert.equal(a, b);
  assert.equal(
    a,
    '{"id":"evt_1","type":"lead.qualified","occurred_at":"2026-09-07T10:00:00.000Z","organization_id":"org_1","data":{"lead":{"id":"l1","score":80}}}',
  );
});
