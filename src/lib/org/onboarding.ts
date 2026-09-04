import { createClient } from "@/lib/supabase/server";
import { hasIndustryTemplate } from "@/lib/config";
import { validateOnboarding } from "@/lib/auth/validation";
import { getUserMembership } from "@/lib/org/membership.server";
import { requireUser } from "@/lib/auth/session";
import { ONBOARDING_INDUSTRY_SLUGS } from "@/lib/org/onboarding-industries";
import {
  isAlreadyMemberError,
  mapOnboardingError,
} from "@/lib/org/onboarding-errors";

export type OnboardingOutcome =
  | { status: "created"; organizationId: string }
  | { status: "already-member"; organizationId: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

/**
 * Create the current user's first organization: organization + `owner`
 * membership + empty config, atomically, via the
 * `create_organization_with_owner` RPC (SECURITY DEFINER, owner = auth.uid()).
 *
 * If the user already belongs to an organization, nothing is created and their
 * existing membership/role is returned untouched.
 */
export async function onboardCurrentUser(
  nameRaw: unknown,
  industryRaw: unknown,
): Promise<OnboardingOutcome> {
  const user = await requireUser();

  // Only templates offered in onboarding, and only ones the registry actually
  // has — belt and braces so a crafted request can't seed an unknown slug.
  const allowedSlugs = ONBOARDING_INDUSTRY_SLUGS.filter(hasIndustryTemplate);
  const parsed = validateOnboarding(nameRaw, industryRaw, allowedSlugs);
  if (!parsed.ok) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.fieldErrors as Record<string, string>,
    };
  }

  // Never create a second organization for an existing member.
  const existing = await getUserMembership(user.id);
  if (existing) {
    return { status: "already-member", organizationId: existing.organizationId };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization_with_owner", {
    p_name: parsed.name,
    p_industry_template_id: parsed.industry,
  });

  if (error) {
    // Lost a concurrent onboarding race → the user is now a member; not an error.
    if (isAlreadyMemberError(error)) {
      const now = await getUserMembership(user.id);
      if (now) {
        return { status: "already-member", organizationId: now.organizationId };
      }
    }
    return { status: "error", message: mapOnboardingError(error) };
  }

  const org = data as { id: string } | null;
  if (!org?.id) {
    return {
      status: "error",
      message: "Something went wrong creating your organization.",
    };
  }
  return { status: "created", organizationId: org.id };
}
