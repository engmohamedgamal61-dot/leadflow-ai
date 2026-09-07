/**
 * Builds the `data` object of an outbound webhook envelope from a snapshot of
 * current state, taken at fan-out time. Kept deliberately lean and stable — a
 * webhook consumer maps these fields, so adding is safe but renaming is not.
 *
 * `db` is the trusted service-role client (the worker has no user session);
 * every read is still explicitly `organization_id`-scoped as defence in depth.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { IntegrationEventType } from "./events.ts";

type Db = SupabaseClient<Database>;

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** A stable, PII-light lead object shared by every lead-scoped event. */
async function leadSnapshot(
  db: Db,
  organizationId: string,
  leadId: string | null,
): Promise<Record<string, unknown> | null> {
  if (!leadId) return null;
  const { data } = await db
    .from("leads")
    .select(
      "id, name, email, phone, status, temperature, score, source, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    phone: data.phone,
    status: data.status,
    temperature: data.temperature,
    score: data.score,
    source: data.source,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

async function appointmentSnapshot(
  db: Db,
  organizationId: string,
  appointmentId: string | null,
): Promise<Record<string, unknown> | null> {
  if (!appointmentId) return null;
  const { data } = await db
    .from("appointments")
    .select("id, starts_at, ends_at, timezone, status, source, provider_event_id")
    .eq("organization_id", organizationId)
    .eq("id", appointmentId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    timezone: data.timezone,
    status: data.status,
    source: data.source,
    provider_event_id: data.provider_event_id,
  };
}

export async function buildEventData(
  db: Db,
  input: {
    organizationId: string;
    eventType: IntegrationEventType;
    leadId: string | null;
    /** The outbox row's `payload` — event-specific bits from the source row. */
    payload: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const { organizationId, eventType, leadId, payload } = input;
  const lead = await leadSnapshot(db, organizationId, leadId);
  const data: Record<string, unknown> = {};
  if (lead) data.lead = lead;

  switch (eventType) {
    case "lead.status_changed":
      data.from = str(payload.from);
      data.to = str(payload.to);
      break;
    case "appointment.booked":
    case "appointment.rescheduled":
    case "appointment.cancelled": {
      const appt = await appointmentSnapshot(
        db,
        organizationId,
        str(payload.appointmentId),
      );
      if (appt) data.appointment = appt;
      if (eventType === "appointment.cancelled" && str(payload.reason)) {
        data.reason = str(payload.reason);
      }
      break;
    }
    case "follow_up.executed":
      data.follow_up = {
        id: str(payload.followUpId),
        channel: str(payload.channel),
        attempt: typeof payload.attempt === "number" ? payload.attempt : null,
      };
      break;
    case "handoff.requested":
      data.reason = str(payload.reason);
      break;
    case "recovery.started":
      data.recovery = {
        attempt_id: str(payload.attemptId),
        reason_key: str(payload.reasonKey),
        priority: str(payload.priority),
      };
      break;
    case "recovery.resolved":
      data.recovery = {
        attempt_id: str(payload.attemptId),
        resolved_as: str(payload.resolvedAs),
      };
      break;
    default:
      break;
  }

  return data;
}
