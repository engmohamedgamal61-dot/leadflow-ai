import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSessionUser } from "@/lib/auth/session";
import { APP_HOME_PATH } from "@/lib/auth/route-policy";
import { safeNextPath } from "@/lib/auth/next-path";
import { isSignupGated } from "@/lib/auth/signup-gate";
import { getI18n } from "@/i18n/server";
import { SignupForm } from "./signup-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.createAccount };
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const { next: nextRaw, email } = await searchParams;
  const next = safeNextPath(nextRaw, "");
  if (await getSessionUser()) redirect(next || APP_HOME_PATH);
  const { t } = await getI18n();
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <AuthShell
      title={t("auth.signup.title")}
      subtitle={t("auth.signup.subtitle")}
      footer={
        <>
          {t("auth.signup.footerText")}{" "}
          <Link href={loginHref} className="text-foreground hover:text-accent">
            {t("auth.signup.footerLink")}
          </Link>
        </>
      }
    >
      <SignupForm
        next={next || undefined}
        gated={isSignupGated()}
        emailDefault={typeof email === "string" ? email : undefined}
      />
    </AuthShell>
  );
}
