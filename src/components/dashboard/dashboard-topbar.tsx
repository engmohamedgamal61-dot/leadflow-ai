"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { UserMenu } from "@/components/dashboard/user-menu";
import {
  BellIcon,
  CalendarDateIcon,
  SearchIcon,
} from "@/components/icons";

/**
 * The dashboard top bar: a global lead search, a today chip, the EN/AR
 * switcher, a notifications shortcut, and the user menu. The menu button on
 * the far start opens the mobile sidebar drawer.
 */
export function DashboardTopbar({
  displayName,
  userEmail,
  roleLabel,
  todayLabel,
  onOpenMenu,
}: {
  displayName: string;
  userEmail: string;
  roleLabel: string;
  todayLabel: string;
  onOpenMenu: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/dashboard/leads?q=${encodeURIComponent(q)}` : "/dashboard/leads");
  };

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-2 backdrop-blur sm:px-5">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t("navigation.openMenu")}
        className="rounded-lg border border-border p-1.5 text-muted hover:text-foreground md:hidden"
      >
        <MenuGlyph />
      </button>

      <form onSubmit={submit} className="relative min-w-0 flex-1 sm:max-w-md">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted/70" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("dashboard.topbar.searchPlaceholder")}
          aria-label={t("dashboard.topbar.searchLabel")}
          className="w-full rounded-xl border border-transparent bg-foreground/[0.04] py-2 ps-9 pe-3 text-[13px] text-foreground placeholder:text-muted/70 outline-none focus:border-accent/40 focus:bg-surface"
        />
      </form>

      <span className="hidden items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-xs text-muted lg:flex">
        <CalendarDateIcon className="h-4 w-4" />
        <span className="whitespace-nowrap tabular-nums">{todayLabel}</span>
      </span>

      <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <LanguageSwitcher size="compact" />
        <Link
          href="/dashboard/activity"
          aria-label={t("dashboard.topbar.notifications")}
          className="rounded-xl border border-border bg-surface p-2 text-muted transition-colors hover:text-foreground"
        >
          <BellIcon className="h-4 w-4" />
        </Link>
        <UserMenu name={displayName} email={userEmail} roleLabel={roleLabel} />
      </div>
    </header>
  );
}

function MenuGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
