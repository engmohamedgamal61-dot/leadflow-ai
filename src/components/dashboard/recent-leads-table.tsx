"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { formatDate } from "@/lib/leads/format";
import {
  ActionBadge,
  RiskBadge,
  StatusBadge,
  TemperatureBadge,
} from "@/components/dashboard/badges";

export interface RecentLeadRow {
  id: string;
  name: string | null;
  source: string | null;
  status: string;
  temperature: string;
  createdAt: string;
  riskLevel?: string;
  action?: string;
}

export function RecentLeadsTable({ rows }: { rows: RecentLeadRow[] }) {
  const { t, locale } = useI18n();

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-start text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">{t("leads.columns.name")}</th>
              <th className="px-4 py-2.5 font-medium">{t("leads.columns.source")}</th>
              <th className="px-4 py-2.5 font-medium">{t("leads.columns.status")}</th>
              <th className="px-4 py-2.5 font-medium">{t("leads.columns.temp")}</th>
              <th className="px-4 py-2.5 font-medium">{t("insights.sectionTitle")}</th>
              <th className="px-4 py-2.5 font-medium">{t("leads.columns.created")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {rows.map((lead) => (
              <tr key={lead.id} className="transition-colors hover:bg-background/50">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/dashboard/leads/${lead.id}`}
                    className="font-medium text-foreground hover:text-accent"
                  >
                    {lead.name ?? t("common.unnamedLead")}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted">{lead.source ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge value={lead.status} />
                </td>
                <td className="px-4 py-2.5">
                  <TemperatureBadge value={lead.temperature} />
                </td>
                <td className="px-4 py-2.5">
                  {lead.action && lead.action !== "none" ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {lead.riskLevel && lead.riskLevel !== "none" ? (
                        <RiskBadge value={lead.riskLevel} />
                      ) : null}
                      <ActionBadge value={lead.action} />
                    </div>
                  ) : (
                    <span className="text-muted/60">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {formatDate(lead.createdAt, locale)}
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
              className="block px-3 py-3 transition-colors hover:bg-background/50"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-foreground">
                  {lead.name ?? t("common.unnamedLead")}
                </p>
                <span className="shrink-0 text-[11px] text-muted">
                  {formatDate(lead.createdAt, locale)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusBadge value={lead.status} />
                <TemperatureBadge value={lead.temperature} />
                {lead.riskLevel && lead.riskLevel !== "none" ? (
                  <RiskBadge value={lead.riskLevel} />
                ) : null}
                {lead.action && lead.action !== "none" ? (
                  <ActionBadge value={lead.action} />
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
