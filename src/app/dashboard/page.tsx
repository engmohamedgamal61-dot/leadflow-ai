import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/lib/auth/session";
import { getUserMembership } from "@/lib/org/membership.server";
import { getIndustryTemplate } from "@/lib/config";
import { ONBOARDING_PATH } from "@/lib/auth/route-policy";

export const metadata: Metadata = { title: "Dashboard — LeadFlow AI" };

/**
 * Minimal protected placeholder — enough to validate routing and membership
 * resolution. The real dashboard is a later phase.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  const membership = await getUserMembership(user.id);
  if (!membership) redirect(ONBOARDING_PATH);

  const template = getIndustryTemplate(membership.industryTemplateId);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-10 sm:py-16">
      <header className="flex items-center justify-between gap-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">
            LF
          </span>
          LeadFlow AI
        </Link>
        <SignOutButton />
      </header>

      <main className="mt-10 space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Workspace
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">
            {membership.organizationName}
          </h1>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <dt className="text-xs text-muted">Your role</dt>
            <dd className="mt-1 text-sm font-medium capitalize text-foreground">
              {membership.role}
            </dd>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <dt className="text-xs text-muted">Industry template</dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {template?.name ?? membership.industryTemplateId}
            </dd>
          </div>
        </dl>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm text-muted">
            Your workspace is ready. The lead dashboard is coming soon — in the
            meantime, try your{" "}
            <Link href="/" className="text-foreground hover:text-accent">
              qualification chat
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
