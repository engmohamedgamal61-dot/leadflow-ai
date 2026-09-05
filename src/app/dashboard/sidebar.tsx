"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/i18n/client";

interface NavLink {
  href: string;
  labelKey: string;
  exact: boolean;
}

const TOP_LINKS: NavLink[] = [
  { href: "/dashboard", labelKey: "navigation.dashboard", exact: true },
  { href: "/dashboard/leads", labelKey: "navigation.leads", exact: false },
  { href: "/dashboard/recovery", labelKey: "navigation.recovery", exact: false },
];

const SETTINGS_LINKS: NavLink[] = [
  { href: "/dashboard/settings/ai", labelKey: "navigation.aiAgent", exact: true },
  {
    href: "/dashboard/settings/integrations",
    labelKey: "navigation.integrations",
    exact: false,
  },
];

function isActive(pathname: string, link: NavLink): boolean {
  return link.exact ? pathname === link.href : pathname.startsWith(link.href);
}

function NavItem({
  link,
  onNavigate,
  indent = false,
}: {
  link: NavLink;
  onNavigate: () => void;
  indent?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const active = isActive(pathname, link);

  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
        indent ? "ms-3" : ""
      } ${
        active
          ? "bg-accent/15 font-medium text-foreground"
          : "text-muted hover:bg-surface hover:text-foreground"
      }`}
    >
      {t(link.labelKey)}
    </Link>
  );
}

function SidebarNav({
  canManageSettings,
  onNavigate,
}: {
  canManageSettings: boolean;
  onNavigate: () => void;
}) {
  const { t } = useI18n();

  return (
    <nav aria-label={t("navigation.dashboard")} className="space-y-1 px-3">
      {TOP_LINKS.map((link) => (
        <NavItem key={link.href} link={link} onNavigate={onNavigate} />
      ))}

      {canManageSettings ? (
        <div className="pt-3">
          <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted/70">
            {t("navigation.settings")}
          </p>
          <div className="space-y-1">
            {SETTINGS_LINKS.map((link) => (
              <NavItem key={link.href} link={link} onNavigate={onNavigate} indent />
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      {open ? (
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M4 6h16M4 12h16M4 18h16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function DashboardShell({
  organizationName,
  roleLabel,
  userEmail,
  canManageSettings,
  children,
}: {
  organizationName: string;
  roleLabel: string;
  userEmail: string;
  canManageSettings: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on navigation. Adjusting state during render
  // (rather than in an effect) per https://react.dev/learn/you-might-not-need-an-effect.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const brand = (
    <div className="flex items-center justify-between gap-2 px-3 py-4">
      <Link
        href="/dashboard"
        className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">
          LF
        </span>
        <span className="truncate">{organizationName}</span>
      </Link>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label={t("navigation.closeMenu")}
        className="shrink-0 rounded-lg p-1.5 text-muted hover:text-foreground md:hidden"
      >
        <MenuIcon open />
      </button>
    </div>
  );

  return (
    <div className="dashboard-shell flex min-h-[100dvh] flex-col bg-background text-foreground md:flex-row">
      {/* Mobile backdrop */}
      {open ? (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      ) : null}

      {/* Sidebar: fixed drawer on mobile, sticky column on desktop.
          The closed-state offset is scoped to `max-md:` (both directions) so
          it never competes with `md:translate-x-0`: `rtl:` alone is
          direction-scoped, not viewport-scoped, so an unscoped
          `rtl:translate-x-full` would have equal specificity to (and, by
          source order, override) `md:translate-x-0` — hiding the sidebar on
          desktop in Arabic while English rendered correctly. */}
      <aside
        className={`dashboard-sidebar fixed inset-y-0 start-0 z-50 flex w-64 shrink-0 flex-col border-e border-border bg-surface transition-transform duration-200 ease-out md:sticky md:top-0 md:z-0 md:h-[100dvh] md:translate-x-0 ${
          open ? "translate-x-0" : "max-md:-translate-x-full max-md:rtl:translate-x-full"
        }`}
      >
        {brand}
        <div className="flex-1 overflow-y-auto pb-4">
          <SidebarNav canManageSettings={canManageSettings} onNavigate={() => setOpen(false)} />
        </div>
      </aside>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("navigation.openMenu")}
            className="rounded-lg border border-border p-1.5 text-muted hover:text-foreground md:hidden"
          >
            <MenuIcon open={false} />
          </button>

          <div className="flex items-center gap-3 text-xs text-muted md:ms-auto">
            <span className="hidden sm:inline">{roleLabel}</span>
            <span className="hidden max-w-[12rem] truncate sm:inline">{userEmail}</span>
            <LanguageSwitcher size="compact" />
            <SignOutButton />
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
