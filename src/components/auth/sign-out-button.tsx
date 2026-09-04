"use client";

import { useTransition } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { useI18n } from "@/i18n/client";

interface SignOutButtonProps {
  variant?: "button" | "link";
}

export function SignOutButton({ variant = "button" }: SignOutButtonProps) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  const onClick = () => startTransition(() => void signOutAction());
  const label = pending ? t("auth.signingOut") : t("auth.signOut");

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-foreground underline-offset-2 hover:text-accent hover:underline disabled:opacity-50"
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
    >
      {label}
    </button>
  );
}
