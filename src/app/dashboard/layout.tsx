import type { ReactNode } from "react";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { resolveDisplayName } from "@/lib/org/display-name";
import { formatTime, formatWeekdayDate } from "@/lib/leads/format";
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
  const { t, tOptional, locale } = await getI18n();
  const roleLabel = tOptional(`roles.${membership.role}`) ?? membership.role;
  const now = new Date();

  return (
    <DashboardShell
      organizationName={membership.organizationName}
      displayName={resolveDisplayName(user)}
      roleLabel={roleLabel}
      userEmail={user.email ?? ""}
      canManageSettings={canManageConfig(membership.role)}
      syncedLabel={t("dashboard.statusCard.synced", {
        time: formatTime(now, locale),
      })}
      todayLabel={formatWeekdayDate(now, locale)}
    >
      {children}
    </DashboardShell>
  );
}
