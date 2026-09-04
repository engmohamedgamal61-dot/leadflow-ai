"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganizationContext } from "@/lib/org/context";
import { canWriteLeads } from "@/lib/org/roles";
import { LEAD_STATUSES, type LeadStatusValue } from "@/lib/leads/list-params";

export interface StatusFormState {
  ok?: boolean;
  error?: string;
  status?: LeadStatusValue;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Update a lead's status.
 *
 * The security boundary is the database: the write runs on the user's
 * RLS-scoped session client and is additionally filtered by the
 * membership-derived `organization_id`. `canWriteLeads` here only produces a
 * friendlier message for a `viewer` — RLS would reject the write regardless.
 */
export async function updateLeadStatusAction(
  _prev: StatusFormState,
  formData: FormData,
): Promise<StatusFormState> {
  const { membership } = await requireOrganizationContext();

  const leadId = String(formData.get("leadId") ?? "");
  const nextStatus = String(formData.get("status") ?? "");

  if (!UUID_RE.test(leadId)) return { error: "Invalid lead." };
  if (!(LEAD_STATUSES as readonly string[]).includes(nextStatus)) {
    return { error: "Choose a valid status." };
  }
  const status = nextStatus as LeadStatusValue;

  if (!canWriteLeads(membership.role)) {
    return { error: "Your role is read-only for leads." };
  }

  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("leads")
    .select("status")
    .eq("organization_id", membership.organizationId)
    .eq("id", leadId)
    .maybeSingle();
  if (readError) return { error: "Could not load the lead. Please retry." };
  if (!current) return { error: "Lead not found." };

  if (current.status === status) {
    return { ok: true, status };
  }

  const { data, error } = await supabase
    .from("leads")
    .update({ status })
    .eq("organization_id", membership.organizationId)
    .eq("id", leadId)
    .select("id");

  if (error || !data || data.length === 0) {
    return { error: "You don't have permission to update this lead." };
  }

  // Best-effort timeline entry — same shape the chat pipeline uses. A failure
  // here must not fail the (already committed) status change.
  const { error: eventError } = await supabase.from("lead_events").insert({
    organization_id: membership.organizationId,
    lead_id: leadId,
    event_type: "status_changed",
    metadata: { from: current.status, to: status },
  });
  if (eventError) {
    console.error("status_changed lead_event insert failed:", eventError);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { ok: true, status };
}
