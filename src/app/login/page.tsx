import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSessionUser } from "@/lib/auth/session";
import { APP_HOME_PATH } from "@/lib/auth/route-policy";
import { safeNextPath } from "@/lib/auth/next-path";
import { getI18n } from "@/i18n/server";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.signIn };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: nextRaw } = await searchParams;
  const next = safeNextPath(nextRaw, "");
  if (await getSessionUser()) redirect(next || APP_HOME_PATH);
  const { t } = await getI18n();
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  return (
    <AuthShell
      title={t("auth.login.title")}
      subtitle={t("auth.login.subtitle")}
      footer={
        <>
          {t("auth.login.footerText")}{" "}
          <Link href={signupHref} className="text-foreground hover:text-accent">
            {t("auth.login.footerLink")}
          </Link>
        </>
      }
    >
      <LoginForm next={next || undefined} />
    </AuthShell>
  );
}
