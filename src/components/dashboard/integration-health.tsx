"use client";

import type { ComponentType } from "react";
import { useI18n } from "@/i18n/client";
import { relativeTimeBucket } from "@/lib/leads/format";
import { WidgetIcon, type IconProps } from "@/components/icons";
import { brandIcon, type BrandKey } from "@/components/icons/brands";

export type IntegrationHealthState = "ok" | "warn" | "down" | "off";

/** Neutral chip for brand marks — keeps each brand's colour inside the glyph. */
const BRAND_CHIP = "border border-border bg-surface";

const DOT: Record<IntegrationHealthState, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  down: "bg-rose-500",
  off: "bg-border",
};

export interface IntegrationHealthInput {
  whatsapp: { status: string; lastError: string | null; updatedAt: string } | null;
  calendar: { status: string; lastError: string | null; updatedAt: string } | null;
  widget: { enabled: boolean; allowedOrigins: number; updatedAt: string | null } | null;
  canManage: boolean;
}

interface Row {
  key: string;
  /** A third-party brand mark, when the row is a real external integration. */
  brand?: BrandKey;
  /** Internal icon — used for LeadFlow's own features (e.g. the website widget). */
  icon: ComponentType<IconProps>;
  chip: string;
  name: string;
  state: IntegrationHealthState;
  statusText: string;
  updatedAt: string | null;
}

function Relative({ iso }: { iso: string }) {
  const { t } = useI18n();
  const b = relativeTimeBucket(iso);
  if (b.unit === "now") return <>{t("common.time.justNow")}</>;
  if (b.unit === "minutes")
    return <>{t("common.time.minutesAgo", { count: b.value })}</>;
  if (b.unit === "hours")
    return <>{t("common.time.hoursAgo", { count: b.value })}</>;
  if (b.unit === "days")
    return <>{t("common.time.daysAgo", { count: b.value })}</>;
  return null;
}

export function IntegrationHealth({
  whatsapp,
  calendar,
  widget,
}: IntegrationHealthInput) {
  const { t, tOptional } = useI18n();

  const connRow = (
    key: "whatsapp" | "calendar",
    brand: BrandKey,
    conn: { status: string; lastError: string | null; updatedAt: string } | null,
  ): Row => {
    let state: IntegrationHealthState = "off";
    let statusText = t("dashboard.integrationHealth.status.disconnected");
    if (conn?.status === "connected") {
      state = "ok";
      statusText = t("dashboard.integrationHealth.status.connected");
    } else if (conn?.status === "error") {
      state = "down";
      statusText = t("dashboard.integrationHealth.status.error");
    } else if (conn?.status === "pending") {
      state = "warn";
      statusText = tOptional("dashboard.integrationHealth.status.pending") ?? "Pending";
    }
    return {
      key,
      brand,
      icon: WidgetIcon,
      chip: BRAND_CHIP,
      name: t(`dashboard.integrationHealth.${key}`),
      state,
      statusText,
      updatedAt: conn?.updatedAt ?? null,
    };
  };

  const rows: Row[] = [
    connRow("whatsapp", "whatsapp", whatsapp),
    connRow("calendar", "google_calendar", calendar),
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
      chip: "bg-violet-500/10 text-violet-600",
      name: t("dashboard.integrationHealth.widget.name"),
      state,
      statusText,
      updatedAt: widget.updatedAt,
    });
  }

  return (
    <ul className="divide-y divide-border/70">
      {rows.map((row) => {
        const Brand = brandIcon(row.brand);
        const RowIcon = row.icon;
        return (
          <li
            key={row.key}
            className="flex items-center justify-between gap-3 px-5 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${row.chip}`}
              >
                {Brand ? <Brand className="h-[17px] w-[17px]" /> : <RowIcon className="h-4 w-4" />}
              </span>
              <span className="truncate text-[13px] font-medium text-foreground">
                {row.name}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[12px]">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${DOT[row.state]}`}
                />
                <span
                  className={
                    row.state === "down" ? "text-rose-600" : "text-muted"
                  }
                >
                  {row.statusText}
                </span>
              </span>
              {row.updatedAt ? (
                <span className="hidden whitespace-nowrap text-muted/70 sm:inline">
                  <Relative iso={row.updatedAt} />
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
