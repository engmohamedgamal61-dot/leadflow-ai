import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getSessionUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInvitationByToken } from "@/lib/org/invitations.server";
import { getI18n } from "@/i18n/server";
import { AcceptInviteForm } from "./accept-invite-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.signIn };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { t, tOptional } = await getI18n();

  let invite: Awaited<ReturnType<typeof getInvitationByToken>> = null;
  try {
    invite = await getInvitationByToken(createAdminClient(), token);
  } catch {
    invite = null;
  }

  if (!invite) {
    return (
      <AuthShell title={t("invite.title")} subtitle={t("invite.errors.notFound")}>
        <Link href="/login" className="text-sm text-foreground hover:text-accent">
          {t("auth.forgotPassword.backToLogin")}
        </Link>
      </AuthShell>
    );
  }

  const roleLabel = tOptional(`roles.${invite.role}`) ?? invite.role;
  const subtitle = t("invite.subtitle", {
    org: invite.organizationName || t("common.unnamedLead"),
    role: roleLabel,
  });

  if (invite.status === "expired") {
    return (
      <AuthShell title={t("invite.title")} subtitle={t("invite.errors.expired")}>
        <div />
      </AuthShell>
    );
  }
  if (invite.status === "accepted") {
    return (
      <AuthShell title={t("invite.title")} subtitle={t("invite.alreadyAccepted")}>
        <Link href="/dashboard" className="text-sm text-foreground hover:text-accent">
          {t("invite.goToDashboard")}
        </Link>
      </AuthShell>
    );
  }

  const user = await getSessionUser();
  const nextPath = `/invite/${token}`;

  if (!user) {
    return (
      <AuthShell title={t("invite.title")} subtitle={subtitle}>
        <div className="space-y-3">
          <Link
            href={`/signup?next=${encodeURIComponent(nextPath)}&email=${encodeURIComponent(invite.email)}`}
            className="block rounded-lg bg-accent px-3 py-2 text-center text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            {t("invite.createAccount")}
          </Link>
          <p className="text-center text-xs text-muted">
            {t("invite.haveAccount")}{" "}
            <Link
              href={`/login?next=${encodeURIComponent(nextPath)}`}
              className="text-foreground hover:text-accent"
            >
              {t("auth.login.submit")}
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  const emailMatches =
    (user.email ?? "").trim().toLowerCase() === invite.email.trim().toLowerCase();

  if (!emailMatches) {
    return (
      <AuthShell
        title={t("invite.title")}
        subtitle={t("invite.wrongAccount", { email: invite.email })}
      >
        <SignOutButton />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("invite.title")} subtitle={subtitle}>
      <AcceptInviteForm token={token} />
    </AuthShell>
  );
}
