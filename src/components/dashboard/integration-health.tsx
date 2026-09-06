"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { useI18n } from "@/i18n/client";
import { formatDateTime } from "@/lib/leads/format";
import {
  AppointmentIcon,
  ChatIcon,
  WidgetIcon,
  type IconProps,
} from "@/components/icons";

export type IntegrationHealthState = "ok" | "warn" | "down" | "off";

const DOT: Record<IntegrationHealthState, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  down: "bg-rose-500",
  off: "bg-border",
};

export interface IntegrationHealthInput {
  whatsapp: { status: string; lastError: string | null; updatedAt: string } | null;
  calendar: { status: string; lastError: string | null; updatedAt: string } | null;
  widget: { enabled: boolean; allowedOrigins: number } | null;
  /** Whether to render the per-row "Manage" links (owner/admin). */
  canManage: boolean;
}

interface Row {
  key: string;
  icon: ComponentType<IconProps>;
  name: string;
  state: IntegrationHealthState;
  statusText: string;
  manageHref: string;
}

export function IntegrationHealth({
  whatsapp,
  calendar,
  widget,
  canManage,
}: IntegrationHealthInput) {
  const { t, tOptional, locale } = useI18n();

  const connectionRow = (
    key: "whatsapp" | "calendar",
    icon: ComponentType<IconProps>,
    conn: { status: string; lastError: string | null; updatedAt: string } | null,
  ): Row => {
    let state: IntegrationHealthState = "off";
    let statusText = t("dashboard.integrationHealth.notConnected");
    if (conn?.status === "connected") {
      state = "ok";
      statusText = conn.updatedAt
        ? t("dashboard.integrationHealth.lastChecked", {
            date: formatDateTime(conn.updatedAt, locale),
          })
        : t("dashboard.integrationHealth.status.connected");
    } else if (conn?.status === "error") {
      state = "down";
      statusText = conn.lastError
        ? t("dashboard.integrationHealth.lastFailure", { error: conn.lastError })
        : t("dashboard.integrationHealth.status.error");
    } else if (conn?.status === "pending") {
      state = "warn";
      statusText =
        tOptional("dashboard.integrationHealth.status.pending") ?? "Pending";
    }
    return {
      key,
      icon,
      name: t(`dashboard.integrationHealth.${key}`),
      state,
      statusText,
      manageHref: "/dashboard/settings/integrations",
    };
  };

  const rows: Row[] = [
    connectionRow("whatsapp", ChatIcon, whatsapp),
    connectionRow("calendar", AppointmentIcon, calendar),
  ];

  if (widget) {
    let state: IntegrationHealthState = "off";
    let statusText = t("dashboard.integrationHealth.widget.off");
    if (widget.enabled && widget.allowedOrigins > 0) {
      state = "ok";
      statusText = t("dashboard.integrationHealth.widget.live", {
        count: widget.allowedOrigins,
      });
    } else if (widget.enabled) {
      state = "warn";
      statusText = t("dashboard.integrationHealth.widget.noOrigins");
    }
    rows.push({
      key: "widget",
      icon: WidgetIcon,
      name: t("dashboard.integrationHealth.widget.name"),
      state,
      statusText,
      manageHref: "/dashboard/settings/widget",
    });
  }

  return (
    <ul className="divide-y divide-border/70">
      {rows.map((row) => {
        const RowIcon = row.icon;
        return (
          <li
            key={row.key}
            className="flex items-start gap-3 px-3 py-2.5"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-border/50 text-muted">
              <RowIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[row.state]}`}
                />
                {row.name}
              </p>
              <p
                className={`mt-0.5 truncate text-xs ${
                  row.state === "down" ? "text-rose-600/90" : "text-muted"
                }`}
              >
                {row.statusText}
              </p>
            </div>
            {canManage ? (
              <Link
                href={row.manageHref}
                className="shrink-0 whitespace-nowrap text-xs text-accent hover:underline"
              >
                {t("dashboard.integrationHealth.manage")}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
