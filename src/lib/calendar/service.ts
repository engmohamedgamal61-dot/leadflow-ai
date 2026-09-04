/**
 * THE single calendar entry point — called identically by the AI executor
 * (web chat + WhatsApp, via `agent/executor.ts`) and the dashboard's manual
 * booking/reschedule/cancel server actions. One code path, so "the AI and the
 * dashboard use the same calendar service" is true by construction, not by
 * convention.
 *
 * Every mutation: refreshes the token if needed, re-checks live provider
 * availability (soft guard against events created outside LeadFlow), writes
 * through the DB exclusion constraint (hard guard against a concurrent
 * double-book — see the migration), and records a `lead_events` row. Never
 * throws — callers get a typed outcome.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/supabase/types";
import type { CalendarConnectionRecord, TimeSlot } from "./provider.ts";
import { computeAvailableSlots, isSlotFree } from "./availability.ts";
import { toWorkingHours } from "./config.ts";
import { getCalendarProvider } from "./registry.ts";
import { resolveCalendarConnection, persistRefreshedToken } from "./connections.ts";

type Db = SupabaseClient<Database>;

/** Statuses at or past "appointment" — booking never downgrades these. */
const APPOINTMENT_OR_LATER = new Set(["appointment", "won", "lost", "archived"]);
const ACTIVE_APPOINTMENT_STATUSES = ["scheduled", "rescheduled"];
/** Postgres exclusion_violation — raised by the no-overlap constraint. */
const EXCLUSION_VIOLATION = "23P01";

export interface CalendarExecContext {
  db: Db;
  organizationId: string;
  leadId: string;
  conversationId: string | null;
  requestId: string | null;
  source: "chat" | "manual";
}

export interface CalendarActionOutcome {
  status: "executed" | "skipped" | "failed";
  /** Dotted `errors.calendar.*` / `calendar.*` dictionary key. */
  detailCode?: string;
  appointmentId?: string;
  slot?: TimeSlot;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function metaJson(v: Record<string, unknown>): TablesInsert<"lead_events">["metadata"] {
  return v as TablesInsert<"lead_events">["metadata"];
}

async function recordEvent(
  ctx: CalendarExecContext,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await ctx.db.from("lead_events").upsert(
    {
      organization_id: ctx.organizationId,
      lead_id: ctx.leadId,
      event_type: eventType,
      metadata: metaJson(metadata),
      request_id: ctx.requestId,
    },
    { onConflict: "lead_id,request_id,event_type", ignoreDuplicates: true },
  );
  if (error) console.error(`lead_event "${eventType}" insert failed:`, error);
}

/** Resolve a fresh connection + provider, refreshing (and persisting) the token if needed. */
async function resolveFreshConnection(
  db: Db,
  organizationId: string,
): Promise<CalendarConnectionRecord | null> {
  const connection = await resolveCalendarConnection(db, organizationId);
  if (!connection) return null;

  const provider = getCalendarProvider(connection.provider);
  const fresh = await provider.ensureFreshToken(connection);
  if (!fresh) return null;
  if (fresh.accessToken !== connection.accessToken) {
    await persistRefreshedToken(db, connection.id, fresh.accessToken, fresh.expiresAt);
  }
  return { ...connection, accessToken: fresh.accessToken, tokenExpiresAt: fresh.expiresAt };
}

/**
 * Real, provider-backed availability for an organization.
 *
 * `null` means "no connected calendar" — callers (the system prompt, the
 * manual-book form) should not mention appointments at all. `[]` means
 * "connected, but genuinely nothing open" — that IS worth telling the
 * prospect. Either way, nothing here or downstream ever invents a slot.
 */
export async function getAvailability(
  db: Db,
  organizationId: string,
  now: Date = new Date(),
): Promise<TimeSlot[] | null> {
  const connection = await resolveFreshConnection(db, organizationId);
  if (!connection) return null;

  const provider = getCalendarProvider(connection.provider);
  const range = {
    start: now.toISOString(),
    end: addDays(now, connection.settings.lookaheadDays + 1).toISOString(),
  };
  const busy = await provider.getBusyIntervals(connection, range);

  return computeAvailableSlots({
    workingHours: toWorkingHours(connection.settings),
    busy,
    lookaheadDays: connection.settings.lookaheadDays,
    slotMinutes: connection.settings.slotMinutes,
    minNoticeMs: connection.settings.minNoticeMinutes * 60_000,
    now,
  });
}

/** The lead's one active (upcoming, not cancelled/completed) appointment, if any. */
export async function getActiveAppointment(
  db: Db,
  organizationId: string,
  leadId: string,
): Promise<{ id: string; startsAt: string; endsAt: string; providerEventId: string | null } | null> {
  const { data } = await db
    .from("appointments")
    .select("id, starts_at, ends_at, provider_event_id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .in("status", ACTIVE_APPOINTMENT_STATUSES)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    providerEventId: data.provider_event_id,
  };
}

/** Advance `leads.status` to "appointment" unless it's already at or past that stage. */
async function advanceLeadStatus(ctx: CalendarExecContext): Promise<void> {
  const { data: lead } = await ctx.db
    .from("leads")
    .select("status")
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.leadId)
    .maybeSingle();
  if (!lead || APPOINTMENT_OR_LATER.has(lead.status)) return;

  const { data: updated } = await ctx.db
    .from("leads")
    .update({ status: "appointment" })
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.leadId)
    .select("id");
  if (updated && updated.length > 0) {
    await recordEvent(ctx, "status_changed", { from: lead.status, to: "appointment" });
  }
}

export interface BookAppointmentInput {
  startsAt: string;
  /** Defaults to `startsAt + settings.slotMinutes`. */
  endsAt?: string;
  notes?: string | null;
}

export async function bookAppointment(
  ctx: CalendarExecContext,
  input: BookAppointmentInput,
): Promise<CalendarActionOutcome> {
  const connection = await resolveFreshConnection(ctx.db, ctx.organizationId);
  if (!connection) return { status: "failed", detailCode: "errors.calendar.notConnected" };

  const startsAt = input.startsAt;
  const endsAt =
    input.endsAt ?? new Date(Date.parse(startsAt) + connection.settings.slotMinutes * 60_000).toISOString();
  if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) {
    return { status: "failed", detailCode: "errors.calendar.invalidSlot" };
  }

  const provider = getCalendarProvider(connection.provider);

  // Soft guard: re-check the live provider (catches events created outside LeadFlow).
  const busy = await provider.getBusyIntervals(connection, { start: startsAt, end: endsAt });
  if (!isSlotFree({ startsAt, endsAt }, busy)) {
    return { status: "failed", detailCode: "errors.calendar.slotTaken" };
  }

  const created = await provider.createEvent(connection, {
    summary: "LeadFlow appointment",
    startsAt,
    endsAt,
    timezone: connection.settings.timezone,
  });
  if (!created.ok || !created.providerEventId) {
    return { status: "failed", detailCode: "errors.calendar.providerFailed" };
  }

  const row: TablesInsert<"appointments"> = {
    organization_id: ctx.organizationId,
    lead_id: ctx.leadId,
    conversation_id: ctx.conversationId,
    calendar_connection_id: connection.id,
    provider_event_id: created.providerEventId,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: connection.settings.timezone,
    status: "scheduled",
    source: ctx.source,
    notes: input.notes ?? null,
    creation_request_id: ctx.requestId,
  };

  const { data, error } = await ctx.db.from("appointments").insert(row).select("id");

  if (error) {
    // Hard guard: the DB caught a concurrent double-book the soft check missed.
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
      await provider.deleteEvent(connection, created.providerEventId).catch(() => undefined);
      return { status: "failed", detailCode: "errors.calendar.slotTaken" };
    }
    // Idempotency race: a retry of the same requestId already created it.
    if (ctx.requestId) {
      const existing = await ctx.db
        .from("appointments")
        .select("id, starts_at, ends_at")
        .eq("lead_id", ctx.leadId)
        .eq("creation_request_id", ctx.requestId)
        .maybeSingle();
      if (existing.data) {
        await provider.deleteEvent(connection, created.providerEventId).catch(() => undefined);
        return {
          status: "skipped",
          appointmentId: existing.data.id,
          slot: { startsAt: existing.data.starts_at, endsAt: existing.data.ends_at },
        };
      }
    }
    console.error("appointment insert failed:", error);
    return { status: "failed", detailCode: "errors.calendar.bookingFailed" };
  }

  const appointmentId = data?.[0]?.id;
  if (!appointmentId) return { status: "failed", detailCode: "errors.calendar.bookingFailed" };

  await recordEvent(ctx, "appointment_booked", { appointmentId, startsAt, endsAt, source: ctx.source });
  await advanceLeadStatus(ctx);

  return { status: "executed", appointmentId, slot: { startsAt, endsAt } };
}

export interface RescheduleAppointmentInput {
  newStartsAt: string;
  newEndsAt?: string;
}

export async function rescheduleAppointment(
  ctx: CalendarExecContext,
  input: RescheduleAppointmentInput,
): Promise<CalendarActionOutcome> {
  const connection = await resolveFreshConnection(ctx.db, ctx.organizationId);
  if (!connection) return { status: "failed", detailCode: "errors.calendar.notConnected" };

  const active = await getActiveAppointment(ctx.db, ctx.organizationId, ctx.leadId);
  if (!active) return { status: "failed", detailCode: "errors.calendar.noActiveAppointment" };

  const newStartsAt = input.newStartsAt;
  const newEndsAt =
    input.newEndsAt ?? new Date(Date.parse(newStartsAt) + connection.settings.slotMinutes * 60_000).toISOString();
  if (Number.isNaN(Date.parse(newStartsAt)) || Number.isNaN(Date.parse(newEndsAt)) || Date.parse(newEndsAt) <= Date.parse(newStartsAt)) {
    return { status: "failed", detailCode: "errors.calendar.invalidSlot" };
  }

  const provider = getCalendarProvider(connection.provider);
  const busy = await provider.getBusyIntervals(connection, { start: newStartsAt, end: newEndsAt });
  if (!isSlotFree({ startsAt: newStartsAt, endsAt: newEndsAt }, busy)) {
    return { status: "failed", detailCode: "errors.calendar.slotTaken" };
  }

  if (active.providerEventId) {
    const updated = await provider.updateEvent(connection, {
      providerEventId: active.providerEventId,
      startsAt: newStartsAt,
      endsAt: newEndsAt,
      timezone: connection.settings.timezone,
    });
    if (!updated.ok) return { status: "failed", detailCode: "errors.calendar.providerFailed" };
  }

  const { error } = await ctx.db
    .from("appointments")
    .update({ starts_at: newStartsAt, ends_at: newEndsAt, status: "rescheduled" })
    .eq("id", active.id)
    .eq("organization_id", ctx.organizationId);

  if (error) {
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
      // Best-effort revert of the provider event to its previous time.
      if (active.providerEventId) {
        await provider
          .updateEvent(connection, {
            providerEventId: active.providerEventId,
            startsAt: active.startsAt,
            endsAt: active.endsAt,
            timezone: connection.settings.timezone,
          })
          .catch(() => undefined);
      }
      return { status: "failed", detailCode: "errors.calendar.slotTaken" };
    }
    console.error("appointment reschedule failed:", error);
    return { status: "failed", detailCode: "errors.calendar.rescheduleFailed" };
  }

  await recordEvent(ctx, "appointment_rescheduled", {
    appointmentId: active.id,
    from: active.startsAt,
    to: newStartsAt,
  });

  return { status: "executed", appointmentId: active.id, slot: { startsAt: newStartsAt, endsAt: newEndsAt } };
}

export interface CancelAppointmentInput {
  reason?: string | null;
}

export async function cancelAppointment(
  ctx: CalendarExecContext,
  input: CancelAppointmentInput,
): Promise<CalendarActionOutcome> {
  const active = await getActiveAppointment(ctx.db, ctx.organizationId, ctx.leadId);
  if (!active) return { status: "failed", detailCode: "errors.calendar.noActiveAppointment" };

  const connection = await resolveFreshConnection(ctx.db, ctx.organizationId);
  if (connection && active.providerEventId) {
    const provider = getCalendarProvider(connection.provider);
    await provider.deleteEvent(connection, active.providerEventId).catch(() => undefined);
  }

  const { error } = await ctx.db
    .from("appointments")
    .update({ status: "cancelled", cancelled_reason: input.reason ?? null })
    .eq("id", active.id)
    .eq("organization_id", ctx.organizationId);
  if (error) {
    console.error("appointment cancel failed:", error);
    return { status: "failed", detailCode: "errors.calendar.cancelFailed" };
  }

  await recordEvent(ctx, "appointment_cancelled", { appointmentId: active.id, reason: input.reason ?? null });

  return { status: "executed", appointmentId: active.id };
}
