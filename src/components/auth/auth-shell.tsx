import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Secondary link shown under the card (e.g. "Already have an account?"). */
  footer?: ReactNode;
}

/**
 * Centered card layout for the auth + onboarding pages. Matches the chat
 * widget's dark premium surface treatment.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-center">
          <LanguageSwitcher />
        </div>
        <div className="mb-8 flex flex-col items-center text-center">
          <Link
            href="/"
            className="mb-5 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">
              LF
            </span>
            LeadFlow AI
          </Link>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle ? (
            <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-2xl shadow-black/40">
          {children}
        </div>

        {footer ? (
          <p className="mt-6 text-center text-sm text-muted">{footer}</p>
        ) : null}
      </div>
    </div>
  );
}
