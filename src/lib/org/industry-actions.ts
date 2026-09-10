"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganizationContext } from "@/lib/org/context";
import { decideIndustryChange } from "@/lib/org/industry";

/**
 * Change the current organization's industry template.
 *
 * Security:
 *   - `requireOrganizationContext` resolves the org from the authenticated
 *     user's `organization_members` row — a client-supplied organization id is
 *     never read here or anywhere.
 *   - `decideIndustryChange` re-checks owner/admin and validates the slug
 *     against the supported template list.
 *   - the write goes through `set_organization_industry` (SECURITY DEFINER),
 *     which derives the target org from `auth.uid()` again and is owner/admin
 *     only — so a viewer/manager/sales session is rejected here AND by the RPC,
 *     and org A can never touch org B.
 *
 * Config overrides are industry-coupled, so the RPC resets
 * `organization_configs.config` to `{}` — the org reverts to the new template's
 * defaults (nothing invalid is left behind). The chat presentation and the AI
 * effective config both read `industry_template_id` fresh on the next request,
 * so the change takes effect immediately.
 */
export interface ChangeIndustryFormState {
  ok?: boolean;
  /** Set on a successful change (not a no-op) so the UI can warn about the reset. */
  changed?: boolean;
  /** Dotted dictionary key. */
  errorCode?: string;
}

export async function changeIndustryAction(
  _prev: ChangeIndustryFormState,
  formData: FormData,
): Promise<ChangeIndustryFormState> {
  const { membership } = await requireOrganizationContext();

  const decision = decideIndustryChange(
    formData.get("industry"),
    membership.industryTemplateId,
    membership.role,
  );

  if (!decision.ok) {
    return {
      errorCode:
        decision.reason === "forbidden"
          ? "settingsIndustry.errors.forbidden"
          : "settingsIndustry.errors.invalid",
    };
  }

  if (decision.action === "noop") return { ok: true, changed: false };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_organization_industry", {
    p_industry_template_id: decision.slug,
  });
  if (error) {
    return { errorCode: "settingsIndustry.errors.failed" };
  }

  // Everything downstream (chat presentation, effective AI config, dashboard
  // labels) reads `industry_template_id` per-request — revalidate so the
  // dashboard shell picks it up now.
  revalidatePath("/", "layout");
  return { ok: true, changed: true };
}
