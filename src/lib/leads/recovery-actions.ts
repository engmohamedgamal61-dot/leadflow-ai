"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationContext } from "@/lib/org/context";
import { canWriteLeads } from "@/lib/org/roles";
import { startRecoveryAttempt } from "@/lib/leads/queries";

export interface RecoveryFormState {
  ok?: boolean;
  /** Dotted dictionary key. */
  errorCode?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts a recovery attempt for one lead — the dashboard's "Start recovery"
 * button on the Revenue Recovery page. Eligibility is always re-checked
 * server-side in `startRecoveryAttempt`; this action only gates by role.
 */
export async function startRecoveryAction(
  _prev: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const leadId = String(formData.get("leadId") ?? "");
  if (!UUID_RE.test(leadId)) {
    return { errorCode: "errors.leads.invalidLead" };
  }

  const { membership } = await requireOrganizationContext();
  if (!canWriteLeads(membership.role)) {
    return { errorCode: "errors.leads.roleReadonly" };
  }

  const outcome = await startRecoveryAttempt(membership.organizationId, leadId);
  if (outcome.status === "already_in_progress") {
    return { errorCode: "recovery.errors.alreadyInProgress" };
  }
  if (outcome.status === "not_eligible") {
    return { errorCode: "recovery.errors.notEligible" };
  }
  if (outcome.status === "failed") {
    return { errorCode: "recovery.errors.startFailed" };
  }

  revalidatePath("/dashboard/recovery");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { ok: true };
}
