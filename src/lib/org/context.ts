import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/session";
import { getUserMembership } from "@/lib/org/membership.server";
import type { UserMembership } from "@/lib/org/membership";
import { ONBOARDING_PATH } from "@/lib/auth/route-policy";

export { canWriteLeads, canManageLeads } from "@/lib/org/roles";

export interface OrganizationContext {
  user: User;
  membership: UserMembership;
}

/**
 * The authenticated user + their organization membership, for any dashboard
 * route. Redirects to `/login` (no session) or `/onboarding` (no organization).
 *
 * `cache()` dedupes the auth + membership lookups across a single render pass,
 * so a layout and its pages can all call this without extra round trips. The
 * organization is ALWAYS derived here from membership — no route ever accepts
 * an organization id from the client.
 */
export const requireOrganizationContext = cache(
  async (): Promise<OrganizationContext> => {
    const user = await requireUser();
    const membership = await getUserMembership(user.id);
    if (!membership) redirect(ONBOARDING_PATH);
    return { user, membership };
  },
);
