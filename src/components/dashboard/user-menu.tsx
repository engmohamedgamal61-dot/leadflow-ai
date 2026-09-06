"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { useI18n } from "@/i18n/client";
import { ChevronDownIcon } from "@/components/icons";

function initials(name: string, email: string): string {
  const base = name.trim() || email.split("@")[0] || "?";
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || base[0] || "?").toUpperCase();
}

export function UserMenu({
  name,
  email,
  roleLabel,
}: {
  name: string;
  email: string;
  roleLabel: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const displayName = name || email.split("@")[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-1.5 py-1 text-xs text-foreground transition-colors hover:border-accent/40"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/12 text-[11px] font-semibold text-accent">
          {initials(name, email)}
        </span>
        <span className="hidden max-w-[9rem] truncate font-medium sm:inline">
          {displayName}
        </span>
        <ChevronDownIcon className="hidden h-3.5 w-3.5 text-muted sm:block" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute end-0 z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-lg shadow-black/5"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium text-foreground">
              {displayName}
            </p>
            <p className="truncate text-xs text-muted">{email}</p>
            <span className="mt-1.5 inline-block rounded-md bg-border/50 px-1.5 py-0.5 text-[11px] font-medium text-muted">
              {roleLabel}
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={() => startTransition(() => void signOutAction())}
            className="block w-full px-3 py-2 text-start text-sm text-foreground transition-colors hover:bg-background/60 disabled:opacity-50"
          >
            {pending ? t("auth.signingOut") : t("auth.signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
