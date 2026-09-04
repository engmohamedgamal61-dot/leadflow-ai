"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizationContext } from "@/lib/org/context";
import { canWriteLeads } from "@/lib/org/roles";
import {
  bookAppointment,
  rescheduleAppointment,
  cancelAppointment,
  type CalendarExecContext,
} from "@/lib/calendar/service";
import {
  normalizeAppointmentNote,
  normalizeCancelReason,
  validateSlotSelection,
} from "@/lib/calendar/validation";

export interface AppointmentFormState {
  ok?: boolean;
  /** Dotted dictionary key. */
  errorCode?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shared front door for the manual (dashboard) appointment actions.
 *
 * `calendar/service.ts` must decrypt the connection's OAuth tokens to talk to
 * the provider — those columns are revoked from `authenticated` at the
 * database level (see the migration), so — exactly like the AI/chat path in
 * `agent/chat-actions.ts` — this runs on the service-role client. The real
 * gate is the `canWriteLeads` role check below (already server-verified
 * membership, never client-trusted), not RLS on this particular call.
 */
async function withLeadWriteContext(
  leadId: string,
): Promise<
  | { ok: true; ctx: CalendarExecContext; revalidate: () => void }
  | { ok: false; errorCode: string }
> {
  const { membership } = await requireOrganizationContext();
  if (!UUID_RE.test(leadId)) return { ok: false, errorCode: "errors.leads.invalidLead" };
  if (!canWriteLeads(membership.role)) {
    return { ok: false, errorCode: "errors.leads.roleReadonly" };
  }
  const db = createAdminClient();

  const { data: lead } = await db
    .from("leads")
    .select("id")
    .eq("organization_id", membership.organizationId)
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { ok: false, errorCode: "errors.leads.leadNotFound" };

  return {
    ok: true,
    ctx: {
      db,
      organizationId: membership.organizationId,
      leadId,
      conversationId: null,
      requestId: crypto.randomUUID(),
      source: "manual",
    },
    revalidate: () => {
      revalidatePath("/dashboard");
      revalidatePath("/dashboard/leads");
      revalidatePath(`/dashboard/leads/${leadId}`);
    },
  };
}

export async function manualBookAppointmentAction(
  _prev: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const leadId = String(formData.get("leadId") ?? "");
  const slot = validateSlotSelection(formData.get("startsAt"));
  if (!slot.ok) return { errorCode: slot.errorCode };

  const guard = await withLeadWriteContext(leadId);
  if (!guard.ok) return { errorCode: guard.errorCode };

  const outcome = await bookAppointment(guard.ctx, {
    startsAt: slot.iso!,
    notes: normalizeAppointmentNote(formData.get("notes")),
  });
  if (outcome.status === "failed") {
    return { errorCode: outcome.detailCode ?? "errors.calendar.bookingFailed" };
  }
  guard.revalidate();
  return { ok: true };
}

export async function manualRescheduleAppointmentAction(
  _prev: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const leadId = String(formData.get("leadId") ?? "");
  const slot = validateSlotSelection(formData.get("newStartsAt"));
  if (!slot.ok) return { errorCode: slot.errorCode };

  const guard = await withLeadWriteContext(leadId);
  if (!guard.ok) return { errorCode: guard.errorCode };

  const outcome = await rescheduleAppointment(guard.ctx, { newStartsAt: slot.iso! });
  if (outcome.status === "failed") {
    return { errorCode: outcome.detailCode ?? "errors.calendar.rescheduleFailed" };
  }
  guard.revalidate();
  return { ok: true };
}

export async function manualCancelAppointmentAction(
  _prev: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const leadId = String(formData.get("leadId") ?? "");
  const guard = await withLeadWriteContext(leadId);
  if (!guard.ok) return { errorCode: guard.errorCode };

  const outcome = await cancelAppointment(guard.ctx, {
    reason: normalizeCancelReason(formData.get("reason")),
  });
  if (outcome.status === "failed") {
    return { errorCode: outcome.detailCode ?? "errors.calendar.cancelFailed" };
  }
  guard.revalidate();
  return { ok: true };
}
