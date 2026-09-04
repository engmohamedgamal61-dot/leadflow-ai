import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { requireOrganizationContext } from "@/lib/org/context";
import { getI18n } from "@/i18n/server";
import { DashboardNav } from "./nav";

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
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:py-8">
      <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">
              LF
            </span>
            <span className="hidden sm:inline">{membership.organizationName}</span>
          </Link>
          <DashboardNav />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="hidden sm:inline">{roleLabel}</span>
          <span className="hidden max-w-[12rem] truncate sm:inline">
            {user.email}
          </span>
          <LanguageSwitcher size="compact" />
          <SignOutButton />
        </div>
      </header>

      <main className="flex-1 pt-6">{children}</main>
    </div>
  );
}
