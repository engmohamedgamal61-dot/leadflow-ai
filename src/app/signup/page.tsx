import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSessionUser } from "@/lib/auth/session";
import { APP_HOME_PATH } from "@/lib/auth/route-policy";
import { getI18n } from "@/i18n/server";
import { SignupForm } from "./signup-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.createAccount };
}

export default async function SignupPage() {
  if (await getSessionUser()) redirect(APP_HOME_PATH);
  const { t } = await getI18n();

  return (
    <AuthShell
      title={t("auth.signup.title")}
      subtitle={t("auth.signup.subtitle")}
      footer={
        <>
          {t("auth.signup.footerText")}{" "}
          <Link href="/login" className="text-foreground hover:text-accent">
            {t("auth.signup.footerLink")}
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
