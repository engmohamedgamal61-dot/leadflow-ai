"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";
import type {
  GoLiveReadiness,
  ReadinessCheckKey,
  ReadinessState,
} from "@/lib/org/readiness";

const CHECK_HREF: Record<ReadinessCheckKey, string> = {
  aiAgent: "/dashboard/settings/ai",
  whatsapp: "/dashboard/settings/integrations",
  calendar: "/dashboard/settings/integrations",
  bookingHours: "/dashboard/settings/integrations",
};

const DOT: Record<ReadinessState, string> = {
  ready: "bg-emerald-500",
  attention: "bg-amber-500",
  pending: "bg-border",
};

/** Bare content for the Go-Live Readiness panel — the card chrome is the Panel. */
export function GoLiveReadinessPanel({
  readiness,
  canManage,
}: {
  readiness: GoLiveReadiness;
  canManage: boolean;
}) {
  const { t } = useI18n();

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5">
        <p className="text-xs font-medium text-foreground">
          {readiness.allReady
            ? t("dashboard.readiness.allReady")
            : t("dashboard.readiness.progress", {
                ready: readiness.readyCount,
                total: readiness.totalCount,
              })}
        </p>
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${
            readiness.allReady ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
      </div>
      <ul className="divide-y divide-border/70">
        {readiness.checks.map((check) => (
          <li key={check.key} className="flex items-start gap-3 px-3 py-2.5">
            <span
              aria-hidden
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[check.state]}`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">
                {t(`dashboard.readiness.check.${check.key}`)}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {t(check.detailKey, check.detailParams)}
              </p>
            </div>
            {canManage && check.state !== "ready" ? (
              <Link
                href={CHECK_HREF[check.key]}
                className="shrink-0 whitespace-nowrap text-xs text-accent hover:underline"
              >
                {t("dashboard.readiness.setUp")}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
