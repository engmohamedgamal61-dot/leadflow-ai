/**
 * The outbound webhook body — a small, stable envelope. Pure.
 *
 *   {
 *     "id":              "<delivery event id>",   // unique, safe to dedupe on
 *     "type":            "lead.qualified",
 *     "occurred_at":     "2026-09-07T10:00:00.000Z",
 *     "organization_id": "<uuid>",
 *     "data":            { ...event-specific... }
 *   }
 *
 * `data` is built by `fanout.ts` from a lead/appointment snapshot at fan-out
 * time. Keys are emitted in a fixed order so the serialized body (which is what
 * gets HMAC-signed) is deterministic for a given input.
 */

import type { IntegrationEventType } from "./events.ts";

export interface DeliveryEnvelope {
  id: string;
  type: IntegrationEventType;
  occurred_at: string;
  organization_id: string;
  data: Record<string, unknown>;
}

export function buildDeliveryEnvelope(input: {
  eventId: string;
  type: IntegrationEventType;
  occurredAt: string;
  organizationId: string;
  data: Record<string, unknown>;
}): DeliveryEnvelope {
  return {
    id: input.eventId,
    type: input.type,
    occurred_at: input.occurredAt,
    organization_id: input.organizationId,
    data: input.data,
  };
}

/** Deterministic JSON for signing — top-level keys in a fixed order. */
export function serializeEnvelope(envelope: DeliveryEnvelope): string {
  return JSON.stringify({
    id: envelope.id,
    type: envelope.type,
    occurred_at: envelope.occurred_at,
    organization_id: envelope.organization_id,
    data: envelope.data,
  });
}
