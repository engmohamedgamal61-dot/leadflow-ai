"use client";

import { useI18n } from "@/i18n/client";
import { formatDateTime } from "@/lib/leads/format";

interface IntegrationRow {
  key: "whatsapp" | "calendar";
  status: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  connected: "bg-emerald-500/15 text-emerald-700",
  disconnected: "bg-border/50 text-muted",
  error: "bg-rose-500/15 text-rose-700",
  pending: "bg-amber-500/15 text-amber-700",
};

export function IntegrationHealth({
  whatsapp,
  calendar,
}: {
  whatsapp: { status: string; lastError: string | null; updatedAt: string } | null;
  calendar: { status: string; lastError: string | null; updatedAt: string } | null;
}) {
  const { t, tOptional, locale } = useI18n();

  const rows: IntegrationRow[] = [
    {
      key: "whatsapp",
      status: whatsapp?.status ?? null,
      lastError: whatsapp?.lastError ?? null,
      updatedAt: whatsapp?.updatedAt ?? null,
    },
    {
      key: "calendar",
      status: calendar?.status ?? null,
      lastError: calendar?.lastError ?? null,
      updatedAt: calendar?.updatedAt ?? null,
    },
  ];

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {rows.map((row) => {
        const statusKey = row.status ?? "disconnected";
        const label =
          tOptional(`dashboard.integrationHealth.status.${statusKey}`) ??
          tOptional(`whatsapp.status.${statusKey}`) ??
          statusKey;
        return (
          <li key={row.key} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t(`dashboard.integrationHealth.${row.key}`)}
              </p>
              {row.lastError ? (
                <p className="mt-0.5 truncate text-xs text-rose-600/90">
                  {t("dashboard.integrationHealth.lastFailure", { error: row.lastError })}
                </p>
              ) : row.updatedAt ? (
                <p className="mt-0.5 text-xs text-muted">
                  {t("dashboard.integrationHealth.lastChecked", {
                    date: formatDateTime(row.updatedAt, locale),
                  })}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-muted">
                  {t("dashboard.integrationHealth.notConnected")}
                </p>
              )}
            </div>
            <span
              className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                STATUS_STYLE[statusKey] ?? "bg-border/40 text-muted"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
