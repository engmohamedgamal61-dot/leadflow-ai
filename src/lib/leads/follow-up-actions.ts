"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganizationContext } from "@/lib/org/context";
import { canWriteLeads } from "@/lib/org/roles";
import {
  validateFutureTimestamp,
  normalizeNote,
} from "@/lib/agent/actions";
import {
  createFollowUp,
  markQualified,
  requestHumanHandoff,
  type AgentExecContext,
} from "@/lib/agent/executor";

export interface AgentFormState {
  ok?: boolean;
  /** Dotted dictionary key. */
  errorCode?: string;
  /** Interpolation params for `errorCode`. */
  errorParams?: Record<string, string | number>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shared front door for the manual (dashboard) agent actions. The security
 * boundary is the database: after a role check, everything runs on the
 * RLS-scoped session client. `requestId` is fresh per submission so a genuine
 * re-click is a new intent, while the executor's own no-op checks stop
 * accidental duplicates.
 */
async function withLeadWriteContext(
  leadId: string,
): Promise<
  | { ok: true; ctx: AgentExecContext; revalidate: () => void }
  | { ok: false; errorCode: string }
> {
  const { membership } = await requireOrganizationContext();
  if (!UUID_RE.test(leadId)) {
    return { ok: false, errorCode: "errors.leads.invalidLead" };
  }
  if (!canWriteLeads(membership.role)) {
    return { ok: false, errorCode: "errors.leads.roleReadonly" };
  }
  const db = await createClient();

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

export async function createFollowUpAction(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const leadId = String(formData.get("leadId") ?? "");
  const when = validateFutureTimestamp(String(formData.get("scheduledAt") ?? ""));
  if (!when.ok) {
    return {
      errorCode: `errors.leads.${when.errorCode ?? "dateMissing"}`,
      errorParams: when.maxDays ? { maxDays: when.maxDays } : undefined,
    };
  }

  const guard = await withLeadWriteContext(leadId);
  if (!guard.ok) return { errorCode: guard.errorCode };

  const outcome = await createFollowUp(guard.ctx, {
    scheduledAt: when.iso!,
    note: normalizeNote(formData.get("note")),
  });
  if (outcome.status === "failed") {
    return { errorCode: "errors.leads.createFollowUpFailed" };
  }
  guard.revalidate();
  return { ok: true };
}

async function setFollowUpStatus(
  followUpId: string,
  to: "completed" | "cancelled",
  eventType: "follow_up_completed" | "follow_up_cancelled",
): Promise<AgentFormState> {
  const { membership } = await requireOrganizationContext();
  if (!UUID_RE.test(followUpId)) {
    return { errorCode: "errors.leads.invalidFollowUp" };
  }
  if (!canWriteLeads(membership.role)) {
    return { errorCode: "errors.leads.roleReadonly" };
  }

  const db = await createClient();
  const { data, error } = await db
    .from("lead_follow_ups")
    .update({ status: to })
    .eq("organization_id", membership.organizationId)
    .eq("id", followUpId)
    .eq("status", "pending")
    .select("id, lead_id");

  if (error) return { errorCode: "errors.leads.noPermissionChange" };
  if (!data || data.length === 0) {
    return { errorCode: "errors.leads.followUpNotPending" };
  }

  await db.from("lead_events").insert({
    organization_id: membership.organizationId,
    lead_id: data[0].lead_id,
    event_type: eventType,
    metadata: { followUpId },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${data[0].lead_id}`);
  return { ok: true };
}

export async function completeFollowUpAction(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  return setFollowUpStatus(
    String(formData.get("followUpId") ?? ""),
    "completed",
    "follow_up_completed",
  );
}

export async function cancelFollowUpAction(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  return setFollowUpStatus(
    String(formData.get("followUpId") ?? ""),
    "cancelled",
    "follow_up_cancelled",
  );
}

export async function requestHandoffAction(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const guard = await withLeadWriteContext(String(formData.get("leadId") ?? ""));
  if (!guard.ok) return { errorCode: guard.errorCode };

  const outcome = await requestHumanHandoff(guard.ctx, {
    reason: normalizeNote(formData.get("reason")),
  });
  if (outcome.status === "failed") {
    return { errorCode: "errors.leads.handoffFailed" };
  }
  guard.revalidate();
  return { ok: true };
}

export async function markQualifiedAction(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const guard = await withLeadWriteContext(String(formData.get("leadId") ?? ""));
  if (!guard.ok) return { errorCode: guard.errorCode };

  const outcome = await markQualified(guard.ctx);
  if (outcome.status === "failed") {
    return { errorCode: "errors.leads.markQualifiedFailed" };
  }
  guard.revalidate();
  return { ok: true };
}
