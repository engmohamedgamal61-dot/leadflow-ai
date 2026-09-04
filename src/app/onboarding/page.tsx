import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/lib/auth/session";
import { getUserMembership } from "@/lib/org/membership.server";
import { getIndustryTemplate } from "@/lib/config";
import { APP_HOME_PATH } from "@/lib/auth/route-policy";
import { ONBOARDING_INDUSTRY_SLUGS } from "@/lib/org/onboarding-industries";
import { getI18n } from "@/i18n/server";
import { OnboardingForm, type IndustryOption } from "./onboarding-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.onboarding };
}

export default async function OnboardingPage() {
  const user = await requireUser();

  // Already onboarded → never create a second org; go straight to the app.
  const membership = await getUserMembership(user.id);
  if (membership) redirect(APP_HOME_PATH);

  const { t, tOptional } = await getI18n();

  const industries: IndustryOption[] = ONBOARDING_INDUSTRY_SLUGS.map(
    getIndustryTemplate,
  )
    .filter((tpl) => tpl !== undefined)
    .map((tpl) => ({
      slug: tpl.slug,
      name: tOptional(tpl.nameKey ?? "") ?? tpl.name,
      description: tOptional(tpl.descriptionKey ?? "") ?? tpl.description,
    }));

  return (
    <AuthShell
      title={t("onboarding.title")}
      subtitle={t("onboarding.subtitle")}
      footer={
        <>
          {t("onboarding.signedInAs", { email: user.email ?? "" })} ·{" "}
          <SignOutButton variant="link" />
        </>
      }
    >
      <OnboardingForm industries={industries} />
    </AuthShell>
  );
}
