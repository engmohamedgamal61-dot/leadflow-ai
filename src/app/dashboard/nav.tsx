"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/client";

const LINKS = [
  { href: "/dashboard", labelKey: "navigation.overview", exact: true },
  { href: "/dashboard/leads", labelKey: "navigation.leads", exact: false },
  { href: "/dashboard/settings/ai", labelKey: "navigation.aiAgent", exact: true },
  {
    href: "/dashboard/settings/integrations",
    labelKey: "navigation.integrations",
    exact: false,
  },
];

export function DashboardNav() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              active
                ? "bg-surface text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t(link.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
