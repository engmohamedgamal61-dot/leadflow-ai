import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSessionUser } from "@/lib/auth/session";
import { APP_HOME_PATH } from "@/lib/auth/route-policy";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account — LeadFlow AI" };

export default async function SignupPage() {
  if (await getSessionUser()) redirect(APP_HOME_PATH);

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start qualifying leads with AI in minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-foreground hover:text-accent">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
