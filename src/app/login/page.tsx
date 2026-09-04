import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSessionUser } from "@/lib/auth/session";
import { APP_HOME_PATH } from "@/lib/auth/route-policy";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in — LeadFlow AI" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect(APP_HOME_PATH);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your LeadFlow AI workspace."
      footer={
        <>
          New to LeadFlow?{" "}
          <Link href="/signup" className="text-foreground hover:text-accent">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
