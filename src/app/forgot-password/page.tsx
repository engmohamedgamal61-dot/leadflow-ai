import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { getI18n } from "@/i18n/server";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.signIn };
}

export default async function ForgotPasswordPage() {
  const { t } = await getI18n();
  return (
    <AuthShell
      title={t("auth.forgotPassword.title")}
      subtitle={t("auth.forgotPassword.subtitle")}
      footer={
        <Link href="/login" className="text-foreground hover:text-accent">
          {t("auth.forgotPassword.backToLogin")}
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
