import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSessionUser } from "@/lib/auth/session";
import { getI18n } from "@/i18n/server";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.signIn };
}

/**
 * Landing page for the password-recovery link. `/auth/confirm` has already
 * set a session by the time the user gets here; if not (link expired, opened
 * without going through the callback), show a re-request prompt.
 */
export default async function ResetPasswordPage() {
  const user = await getSessionUser();
  const { t } = await getI18n();

  if (!user) {
    return (
      <AuthShell
        title={t("auth.resetPassword.title")}
        subtitle={t("auth.resetPassword.expired")}
        footer={
          <Link href="/forgot-password" className="text-foreground hover:text-accent">
            {t("auth.resetPassword.requestNew")}
          </Link>
        }
      >
        <div />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.resetPassword.title")}
      subtitle={t("auth.resetPassword.subtitle")}
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
