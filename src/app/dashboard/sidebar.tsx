"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { DashboardTopbar } from "@/components/dashboard/dashboard-topbar";
import {
  ActivityIcon,
  AiAgentIcon,
  AppointmentIcon,
  DashboardIcon,
  FollowUpIcon,
  HealthIcon,
  IntegrationsIcon,
  LeadsIcon,
  ReadinessIcon,
  RecoveryIcon,
  TeamIcon,
  WidgetIcon,
  type IconProps,
} from "@/components/icons";
import { useI18n } from "@/i18n/client";

interface NavLink {
  href: string;
  labelKey: string;
  icon: ComponentType<IconProps>;
  /** Match `pathname` exactly (else prefix-match). Hash links are never active. */
  exact?: boolean;
}

const MAIN_LINKS: NavLink[] = [
  { href: "/dashboard", labelKey: "navigation.dashboard", icon: DashboardIcon, exact: true },
  { href: "/dashboard/leads", labelKey: "navigation.leads", icon: LeadsIcon },
  { href: "/dashboard/follow-ups", labelKey: "navigation.followUps", icon: FollowUpIcon },
  { href: "/dashboard/appointments", labelKey: "navigation.appointments", icon: AppointmentIcon },
  { href: "/dashboard/recovery", labelKey: "navigation.recovery", icon: RecoveryIcon },
  { href: "/dashboard/activity", labelKey: "navigation.activity", icon: ActivityIcon },
];

/** Jump links to owner/admin dashboard sections. */
const STATUS_LINKS: NavLink[] = [
  { href: "/dashboard#go-live-readiness", labelKey: "navigation.readiness", icon: ReadinessIcon },
  { href: "/dashboard#integration-health", labelKey: "navigation.integrationHealth", icon: HealthIcon },
];

const SETTINGS_LINKS: NavLink[] = [
  { href: "/dashboard/settings/ai", labelKey: "navigation.aiAgent", icon: AiAgentIcon, exact: true },
  { href: "/dashboard/settings/integrations", labelKey: "navigation.integrations", icon: IntegrationsIcon },
  { href: "/dashboard/settings/team", labelKey: "navigation.team", icon: TeamIcon, exact: true },
  { href: "/dashboard/settings/widget", labelKey: "navigation.widget", icon: WidgetIcon, exact: true },
];

function isActive(pathname: string, link: NavLink): boolean {
  if (link.href.includes("#")) return false;
  return link.exact ? pathname === link.href : pathname.startsWith(link.href);
}

function NavItem({ link, onNavigate }: { link: NavLink; onNavigate: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const active = isActive(pathname, link);
  const Icon = link.icon;

  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-accent/10 font-medium text-accent before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full before:bg-accent before:content-['']"
          : "text-muted hover:bg-accent/5 hover:text-foreground"
      }`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{t(link.labelKey)}</span>
    </Link>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pt-3">
      <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted/60">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
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
    <nav aria-label={t("navigation.dashboard")} className="space-y-0.5 px-3">
      {MAIN_LINKS.map((link) => (
        <NavItem key={link.href} link={link} onNavigate={onNavigate} />
      ))}

      {canManageSettings ? (
        <>
          <div className="my-3 border-t border-border" />
          <div className="space-y-0.5">
            {STATUS_LINKS.map((link) => (
              <NavItem key={link.href} link={link} onNavigate={onNavigate} />
            ))}
          </div>
          <NavGroup label={t("navigation.settings")}>
            {SETTINGS_LINKS.map((link) => (
              <NavItem key={link.href} link={link} onNavigate={onNavigate} />
            ))}
          </NavGroup>
        </>
      ) : null}
    </nav>
  );
}

function StatusCard({ syncedLabel }: { syncedLabel: string }) {
  const { t } = useI18n();
  return (
    <div className="mx-3 mt-2 rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20"
        />
        <p className="text-xs font-medium text-foreground">
          {t("dashboard.statusCard.title")}
        </p>
      </div>
      <p className="mt-1 ps-4 text-[11px] text-muted">{syncedLabel}</p>
    </div>
  );
}

export function DashboardShell({
  organizationName,
  displayName,
  roleLabel,
  userEmail,
  canManageSettings,
  syncedLabel,
  todayLabel,
  children,
}: {
  organizationName: string;
  displayName: string;
  roleLabel: string;
  userEmail: string;
  canManageSettings: boolean;
  syncedLabel: string;
  todayLabel: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on navigation (adjust state during render).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const brand = (
    <div className="flex items-center justify-between gap-2 px-4 py-4">
      <Link
        href="/dashboard"
        className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">
          LF
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate">{t("brand.name")}</span>
          <span className="truncate text-[11px] font-normal text-muted">
            {organizationName}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label={t("navigation.closeMenu")}
        className="shrink-0 rounded-lg p-1.5 text-muted hover:text-foreground md:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );

  return (
    <div className="dashboard-shell flex min-h-[100dvh] flex-col bg-background text-foreground md:flex-row">
      {open ? (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      ) : null}

      {/* Sidebar: fixed drawer on mobile, sticky column on desktop. The
          closed-state offset is scoped to `max-md:` (both directions) so it
          never competes with `md:translate-x-0`. */}
      <aside
        className={`dashboard-sidebar fixed inset-y-0 start-0 z-50 flex w-64 shrink-0 flex-col border-e border-border bg-surface transition-transform duration-200 ease-out md:sticky md:top-0 md:z-0 md:h-[100dvh] md:translate-x-0 ${
          open ? "translate-x-0" : "max-md:-translate-x-full max-md:rtl:translate-x-full"
        }`}
      >
        {brand}
        <div className="flex-1 overflow-y-auto pb-2">
          <SidebarNav
            canManageSettings={canManageSettings}
            onNavigate={() => setOpen(false)}
          />
        </div>
        <div className="pb-3">
          <StatusCard syncedLabel={syncedLabel} />
        </div>
      </aside>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopbar
          displayName={displayName}
          userEmail={userEmail}
          roleLabel={roleLabel}
          todayLabel={todayLabel}
          onOpenMenu={() => setOpen(true)}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-5 sm:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
