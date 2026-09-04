import type { ReactNode } from "react";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { getI18n } from "@/i18n/server";
import { DashboardShell } from "./sidebar";

/**
 * Shared chrome + the auth/organization gate for every `/dashboard/*` route.
 * `requireOrganizationContext` redirects to `/login` (no session) or
 * `/onboarding` (no organization). Pages re-check via the same cached helper.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, membership } = await requireOrganizationContext();
  const { tOptional } = await getI18n();
  const roleLabel = tOptional(`roles.${membership.role}`) ?? membership.role;

  return (
    <DashboardShell
      organizationName={membership.organizationName}
      roleLabel={roleLabel}
      userEmail={user.email ?? ""}
      canManageSettings={canManageConfig(membership.role)}
    >
      {children}
    </DashboardShell>
  );
}
