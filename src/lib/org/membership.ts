import type { OrganizationMemberRole } from "@/lib/supabase/types";

/**
 * The current user's organization, derived from their `organization_members`
 * row. This is the ONLY source of truth for which organization an
 * authenticated request belongs to — never a client-supplied id or param.
 */
export interface UserMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  /** Industry template slug — resolved against the app template registry. */
  industryTemplateId: string;
  role: OrganizationMemberRole;
}

export interface MembershipJoinRow {
  role: OrganizationMemberRole;
  organizations: {
    id: string;
    name: string;
    slug: string;
    industry_template_id: string;
    status: string;
  } | null;
}

/**
 * Pure shaping of the `organization_members` ⋈ `organizations` join row.
 * Returns `null` when the organization is missing or not `active`.
 */
export function toMembership(
  row: MembershipJoinRow | null | undefined,
): UserMembership | null {
  const org = row?.organizations;
  if (!org || org.status !== "active") return null;
  return {
    organizationId: org.id,
    organizationName: org.name,
    organizationSlug: org.slug,
    industryTemplateId: org.industry_template_id,
    role: row.role,
  };
}
