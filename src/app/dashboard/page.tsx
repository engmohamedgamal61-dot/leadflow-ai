import type { Metadata } from "next";
import Link from "next/link";
import { requireOrganizationContext } from "@/lib/org/context";
import { getIndustryTemplate } from "@/lib/config";
import {
  getLeadStats,
  getRecentLeads,
  getFollowUpCounts,
  getNeedsAttentionCount,
  getUpcomingAppointments,
} from "@/lib/leads/queries";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusBadge, TemperatureBadge } from "@/components/dashboard/badges";
import { EmptyState } from "@/components/dashboard/states";
import { formatDate, formatDateTime, formatPercent } from "@/lib/leads/format";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.overview };
}

export default async function DashboardOverviewPage() {
  const { membership } = await requireOrganizationContext();
  const { t, tOptional, locale } = await getI18n();
  const template = getIndustryTemplate(membership.industryTemplateId);
  const templateName = template
    ? (tOptional(template.nameKey ?? "") ?? template.name)
    : membership.industryTemplateId;

  const [stats, recent, followUps, needsAttention, upcomingAppointments] = await Promise.all([
    getLeadStats(membership.organizationId),
    getRecentLeads(membership.organizationId, 6),
    getFollowUpCounts(membership.organizationId),
    getNeedsAttentionCount(membership.organizationId),
    getUpcomingAppointments(membership.organizationId, 6),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {t("dashboard.overviewEyebrow")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          {membership.organizationName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {t("dashboard.workspace", { template: templateName })}
        </p>
      </div>

      <section aria-label={t("dashboard.ariaLeadStatistics")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label={t("dashboard.stats.totalLeads")} value={stats.total} />
          <StatCard label={t("dashboard.stats.hot")} value={stats.hot} accent="hot" />
          <StatCard label={t("dashboard.stats.warm")} value={stats.warm} accent="warm" />
          <StatCard label={t("dashboard.stats.cold")} value={stats.cold} accent="cold" />
          <StatCard label={t("dashboard.stats.qualified")} value={stats.qualified} />
          <StatCard
            label={t("dashboard.stats.conversion")}
            value={
              stats.total > 0
                ? formatPercent(stats.qualified / stats.total, locale)
                : "—"
            }
          />
        </div>
      </section>

      <section aria-label={t("dashboard.ariaAgentWorkload")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:max-w-2xl">
          <StatCard
            label={t("dashboard.workload.pendingFollowUps")}
            value={followUps.pending}
          />
          <StatCard
            label={t("dashboard.workload.dueNow")}
            value={followUps.dueNow}
            accent={followUps.dueNow > 0 ? "warm" : "default"}
          />
          <StatCard
            label={t("dashboard.workload.failedFollowUps")}
            value={followUps.failed}
            accent={followUps.failed > 0 ? "hot" : "default"}
          />
          <StatCard
            label={t("dashboard.workload.needsAttention")}
            value={needsAttention}
            accent={needsAttention > 0 ? "warm" : "default"}
          />
        </div>
      </section>

      <section aria-label={t("dashboard.ariaRecentLeads")} className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("dashboard.recentLeads")}
          </h2>
          <Link
            href="/dashboard/leads"
            className="text-xs text-muted hover:text-foreground"
          >
            {t("common.viewAll")}
          </Link>
        </div>

        {recent.length === 0 ? (
          <EmptyState
            title={t("dashboard.noLeadsTitle")}
            hint={t("dashboard.noLeadsHint")}
            action={
              <Link
                href="/"
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
              >
                {t("dashboard.openChat")}
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {recent.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-background/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {lead.name ?? t("common.unnamedLead")}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {lead.intent ?? "—"} ·{" "}
                      {lead.phone ?? lead.email ?? t("common.noContact")} ·{" "}
                      {formatDate(lead.createdAt, locale)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-muted">
                      {lead.score}
                    </span>
                    <TemperatureBadge value={lead.temperature} />
                    <StatusBadge value={lead.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("dashboard.ariaUpcomingAppointments")} className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("dashboard.upcomingAppointments")}
        </h2>

        {upcomingAppointments.length === 0 ? (
          <EmptyState
            title={t("dashboard.noAppointmentsTitle")}
            hint={t("dashboard.noAppointmentsHint")}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {upcomingAppointments.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/dashboard/leads/${a.leadId}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-background/40"
                >
                  <p className="truncate text-sm font-medium text-foreground">
                    {a.leadName ?? t("common.unnamedLead")}
                  </p>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {formatDateTime(a.startsAt, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
