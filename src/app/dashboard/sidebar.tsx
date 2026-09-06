"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { DashboardTopbar } from "@/components/dashboard/dashboard-topbar";
import {
  ActivityIcon,
  AiAgentIcon,
  AppointmentIcon,
  BoltIcon,
  DashboardIcon,
  FollowUpIcon,
  HealthIcon,
  IntegrationsIcon,
  LeadsIcon,
  ReadinessIcon,
  RecoveryIcon,
  SettingsIcon,
  TeamIcon,
  WidgetIcon,
  type IconProps,
} from "@/components/icons";
import { useI18n } from "@/i18n/client";

interface NavLink {
  href: string;
  labelKey: string;
  icon: ComponentType<IconProps>;
  exact?: boolean;
}

const PRIMARY_LINKS: NavLink[] = [
  { href: "/dashboard", labelKey: "navigation.dashboard", icon: DashboardIcon, exact: true },
  { href: "/dashboard/leads", labelKey: "navigation.leads", icon: LeadsIcon },
  { href: "/dashboard/follow-ups", labelKey: "navigation.followUps", icon: FollowUpIcon },
  { href: "/dashboard/appointments", labelKey: "navigation.appointments", icon: AppointmentIcon },
  { href: "/dashboard/recovery", labelKey: "navigation.recovery", icon: RecoveryIcon },
];

const CONFIG_LINKS: NavLink[] = [
  { href: "/dashboard/settings/ai", labelKey: "navigation.aiAgent", icon: AiAgentIcon, exact: true },
  { href: "/dashboard/settings/integrations", labelKey: "navigation.integrations", icon: IntegrationsIcon },
  { href: "/dashboard/settings/team", labelKey: "navigation.team", icon: TeamIcon, exact: true },
  { href: "/dashboard/settings/widget", labelKey: "navigation.widget", icon: WidgetIcon, exact: true },
];

const ACTIVITY_LINK: NavLink = {
  href: "/dashboard/activity",
  labelKey: "navigation.activity",
  icon: ActivityIcon,
};

const STATUS_LINKS: NavLink[] = [
  { href: "/dashboard#go-live-readiness", labelKey: "navigation.readiness", icon: ReadinessIcon },
  { href: "/dashboard#integration-health", labelKey: "navigation.integrationHealth", icon: HealthIcon },
];

const SETTINGS_LINK: NavLink = {
  href: "/dashboard/settings/ai",
  labelKey: "navigation.settings",
  icon: SettingsIcon,
};

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
      className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
        active
          ? "bg-accent/[0.09] font-medium text-accent before:absolute before:inset-y-1.5 before:start-0 before:w-[3px] before:rounded-e-full before:bg-accent before:content-['']"
          : "text-muted hover:bg-accent/[0.05] hover:text-foreground"
      }`}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" />
      <span className="truncate">{t(link.labelKey)}</span>
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
  const item = (link: NavLink) => (
    <NavItem key={link.href} link={link} onNavigate={onNavigate} />
  );

  return (
    <nav
      aria-label={t("navigation.dashboard")}
      className="flex flex-1 flex-col gap-0.5 px-3 py-1"
    >
      {PRIMARY_LINKS.map(item)}
      {canManageSettings ? CONFIG_LINKS.map(item) : null}
      {item(ACTIVITY_LINK)}

      {canManageSettings ? (
        <>
          <div className="my-3 h-px bg-border" />
          {STATUS_LINKS.map(item)}
          <div className="mt-auto pt-3">{item(SETTINGS_LINK)}</div>
        </>
      ) : null}
    </nav>
  );
}

function StatusCard({ syncedLabel }: { syncedLabel: string }) {
  const { t } = useI18n();
  return (
    <div className="mx-3 mb-4 mt-2 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-[3px] h-[7px] w-[7px] shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20"
        />
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold leading-[1.35] text-foreground">
            {t("dashboard.statusCard.title")}
          </p>
          <p className="mt-1 text-[10.5px] leading-tight text-muted">
            {syncedLabel}
          </p>
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({
  displayName,
  roleLabel,
  userEmail,
  canManageSettings,
  syncedLabel,
  todayLabel,
  notify,
  children,
}: {
  organizationName: string;
  displayName: string;
  roleLabel: string;
  userEmail: string;
  canManageSettings: boolean;
  syncedLabel: string;
  todayLabel: string;
  notify: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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
    <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-4">
      <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <BoltIcon className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[15px] font-bold tracking-tight text-foreground">
            {t("brand.name")}
          </span>
          <span className="text-[9px] leading-tight text-muted">
            {t("brand.tagline")}
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

      <aside
        className={`dashboard-sidebar fixed inset-y-0 start-0 z-50 flex w-[218px] shrink-0 flex-col border-e border-border bg-surface transition-transform duration-200 ease-out md:sticky md:top-0 md:z-0 md:h-[100dvh] md:translate-x-0 ${
          open ? "translate-x-0" : "max-md:-translate-x-full max-md:rtl:translate-x-full"
        }`}
      >
        {brand}
        <div className="flex flex-1 flex-col overflow-y-auto">
          <SidebarNav
            canManageSettings={canManageSettings}
            onNavigate={() => setOpen(false)}
          />
        </div>
        <StatusCard syncedLabel={syncedLabel} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopbar
          displayName={displayName}
          userEmail={userEmail}
          roleLabel={roleLabel}
          todayLabel={todayLabel}
          notify={notify}
          onOpenMenu={() => setOpen(true)}
        />
        <main className="w-full flex-1 px-4 py-5 sm:px-6 sm:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
