"use client";

import { useTransition } from "react";
import { signOutAction } from "@/lib/auth/actions";

interface SignOutButtonProps {
  variant?: "button" | "link";
}

export function SignOutButton({ variant = "button" }: SignOutButtonProps) {
  const [pending, startTransition] = useTransition();

  const onClick = () => startTransition(() => void signOutAction());

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-foreground underline-offset-2 hover:text-accent hover:underline disabled:opacity-50"
      >
        {pending ? "Signing out…" : "Sign out"}
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
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
