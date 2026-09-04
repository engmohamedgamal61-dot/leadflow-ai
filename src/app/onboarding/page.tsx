import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/lib/auth/session";
import { getUserMembership } from "@/lib/org/membership.server";
import { getIndustryTemplate } from "@/lib/config";
import { APP_HOME_PATH } from "@/lib/auth/route-policy";
import { ONBOARDING_INDUSTRY_SLUGS } from "@/lib/org/onboarding-industries";
import { OnboardingForm, type IndustryOption } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your organization — LeadFlow AI" };

export default async function OnboardingPage() {
  const user = await requireUser();

  // Already onboarded → never create a second org; go straight to the app.
  const membership = await getUserMembership(user.id);
  if (membership) redirect(APP_HOME_PATH);

  const industries: IndustryOption[] = ONBOARDING_INDUSTRY_SLUGS.map(
    getIndustryTemplate,
  )
    .filter((t) => t !== undefined)
    .map((t) => ({ slug: t.slug, name: t.name, description: t.description }));

  return (
    <AuthShell
      title="Set up your organization"
      subtitle="This picks the AI qualification template your workspace starts from. You can fine-tune it later."
      footer={
        <>
          Signed in as {user.email} · <SignOutButton variant="link" />
        </>
      }
    >
      <OnboardingForm industries={industries} />
    </AuthShell>
  );
}
