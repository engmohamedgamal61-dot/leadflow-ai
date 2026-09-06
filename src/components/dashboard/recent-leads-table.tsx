"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { formatDate, relativeTimeBucket } from "@/lib/leads/format";
import { StatusBadge } from "@/components/dashboard/badges";
import { SourceMark } from "@/components/dashboard/source-mark";

export interface RecentLeadRow {
  id: string;
  name: string | null;
  /** Phone or email — the closest real per-lead attribute to the mock's "Company". */
  contact: string | null;
  source: string | null;
  status: string;
  temperature: string;
  createdAt: string;
}

const OPP: Record<string, string> = {
  hot: "text-rose-600",
  warm: "text-amber-600",
  cold: "text-sky-600",
};

function Opportunity({ temperature }: { temperature: string }) {
  const { tOptional } = useI18n();
  const key = temperature.toLowerCase();
  return (
    <span className={`text-[13px] font-medium ${OPP[key] ?? "text-muted"}`}>
      {tOptional(`temperatures.${key}`) ?? key}
    </span>
  );
}

function RelDate({ iso }: { iso: string }) {
  const { t, locale } = useI18n();
  const b = relativeTimeBucket(iso);
  if (b.unit === "now") return <>{t("common.time.justNow")}</>;
  if (b.unit === "minutes")
    return <>{t("common.time.minutesAgo", { count: b.value })}</>;
  if (b.unit === "hours")
    return <>{t("common.time.hoursAgo", { count: b.value })}</>;
  if (b.unit === "days")
    return <>{t("common.time.daysAgo", { count: b.value })}</>;
  return <>{formatDate(iso, locale)}</>;
}

export function RecentLeadsTable({ rows }: { rows: RecentLeadRow[] }) {
  const { t } = useI18n();

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-y border-border text-start text-[12px] text-muted">
              <th className="px-5 py-2.5 font-medium">{t("leads.columns.name")}</th>
              <th className="px-5 py-2.5 font-medium">{t("leads.columns.contact")}</th>
              <th className="px-5 py-2.5 font-medium">{t("leads.columns.source")}</th>
              <th className="px-5 py-2.5 font-medium">{t("leads.columns.status")}</th>
              <th className="px-5 py-2.5 font-medium">{t("dashboard.recentLeadsOpportunity")}</th>
              <th className="px-5 py-2.5 font-medium">{t("leads.columns.created")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {rows.map((lead) => (
              <tr key={lead.id} className="transition-colors hover:bg-background">
                <td className="px-5 py-3">
                  <Link
                    href={`/dashboard/leads/${lead.id}`}
                    className="font-medium text-foreground hover:text-accent"
                  >
                    {lead.name ?? t("common.unnamedLead")}
                  </Link>
                </td>
                <td className="px-5 py-3 text-muted">{lead.contact ?? "—"}</td>
                <td className="px-5 py-3 text-muted">
                  <SourceMark source={lead.source} />
                </td>
                <td className="px-5 py-3">
                  <StatusBadge value={lead.status} />
                </td>
                <td className="px-5 py-3">
                  <Opportunity temperature={lead.temperature} />
                </td>
                <td className="px-5 py-3 text-muted">
                  <RelDate iso={lead.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-border/70 md:hidden">
        {rows.map((lead) => (
          <li key={lead.id}>
            <Link
              href={`/dashboard/leads/${lead.id}`}
              className="block px-5 py-3 transition-colors hover:bg-background"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-foreground">
                  {lead.name ?? t("common.unnamedLead")}
                </p>
                <span className="shrink-0 text-[11px] text-muted">
                  <RelDate iso={lead.createdAt} />
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusBadge value={lead.status} />
                <Opportunity temperature={lead.temperature} />
                {lead.source ? (
                  <span className="text-[11px] text-muted">
                    <SourceMark source={lead.source} />
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
