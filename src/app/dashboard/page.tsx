import type { Metadata } from "next";
import Link from "next/link";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { getIndustryTemplate } from "@/lib/config";
import { loadStoredConfig } from "@/lib/config/organization-config.server";
import { createClient } from "@/lib/supabase/server";
import { getConnectionView } from "@/lib/calendar/connections";
import { getWhatsAppConnectionView } from "@/lib/whatsapp/connections";
import { computeGoLiveReadiness } from "@/lib/org/readiness";
import {
  getLeadStats,
  getRecentLeads,
  getFollowUpCounts,
  getUpcomingAppointments,
  getUpcomingAppointmentCount,
  getInsightSummary,
  getRecoveryCandidates,
  getRecentActivity,
} from "@/lib/leads/queries";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusBadge, TemperatureBadge } from "@/components/dashboard/badges";
import { EmptyState } from "@/components/dashboard/states";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { GoLiveReadinessPanel } from "@/components/dashboard/readiness";
import { IntegrationHealth } from "@/components/dashboard/integration-health";
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
  const canManage = canManageConfig(membership.role);

  const supabase = await createClient();

  const [
    stats,
    recent,
    followUps,
    upcomingAppointments,
    appointmentCount,
    insightSummary,
    recoveryCandidates,
    activity,
    storedConfig,
    whatsapp,
    calendar,
  ] = await Promise.all([
    getLeadStats(membership.organizationId),
    getRecentLeads(membership.organizationId, 6),
    getFollowUpCounts(membership.organizationId),
    getUpcomingAppointments(membership.organizationId, 6),
    getUpcomingAppointmentCount(membership.organizationId),
    getInsightSummary(membership.organizationId),
    getRecoveryCandidates(membership.organizationId),
    getRecentActivity(membership.organizationId),
    canManage ? loadStoredConfig(membership.organizationId) : Promise.resolve(null),
    canManage
      ? getWhatsAppConnectionView(supabase, membership.organizationId)
      : Promise.resolve(null),
    canManage
      ? getConnectionView(supabase, membership.organizationId)
      : Promise.resolve(null),
  ]);

  const recoveryCount = recoveryCandidates.length;
  const isEmptyWorkspace = stats.total === 0;

  const readiness = canManage
    ? computeGoLiveReadiness({
        templateValid: template !== undefined,
        hasCustomConfig: storedConfig !== null && Object.keys(storedConfig).length > 0,
        whatsappStatus: whatsapp?.status ?? null,
        whatsappLastError: whatsapp?.lastError ?? null,
        calendarStatus: calendar?.status ?? null,
        calendarLastError: calendar?.lastError ?? null,
        calendarWorkingDays: calendar?.settings.workingDays ?? [],
      })
    : null;

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

      {isEmptyWorkspace ? (
        <section
          aria-label={t("dashboard.gettingStarted.title")}
          className="rounded-xl border border-border bg-surface p-5"
        >
          <h2 className="text-sm font-semibold text-foreground">
            {t("dashboard.gettingStarted.title")}
          </h2>
          <p className="mt-1 max-w-lg text-sm text-muted">
            {canManage
              ? t("dashboard.gettingStarted.hintManager")
              : t("dashboard.gettingStarted.hintMember")}
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
          >
            {t("dashboard.openChat")}
          </Link>
        </section>
      ) : null}

      <section aria-label={t("dashboard.exec.aria")} className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("dashboard.exec.title")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label={t("dashboard.exec.leadsToday")} value={stats.createdToday} />
          <StatCard label={t("dashboard.exec.hotLeads")} value={stats.hot} accent="hot" />
          <StatCard
            label={t("dashboard.exec.needsAttention")}
            value={insightSummary.needsAttention}
            accent={insightSummary.needsAttention > 0 ? "warm" : "default"}
            href="/dashboard/leads?focus=needs_attention"
          />
          <StatCard label={t("dashboard.exec.appointments")} value={appointmentCount} />
          <StatCard
            label={t("dashboard.exec.recoveryOpportunities")}
            value={recoveryCount}
            accent={recoveryCount > 0 ? "warm" : "default"}
            href="/dashboard/recovery"
          />
          <StatCard
            label={t("dashboard.exec.followUpsDue")}
            value={followUps.dueNow}
            accent={followUps.dueNow > 0 ? "warm" : "default"}
          />
          <StatCard
            label={t("dashboard.exec.conversion")}
            value={stats.total > 0 ? formatPercent(stats.won / stats.total, locale) : "—"}
            sublabel={t("dashboard.exec.conversionSub", { won: stats.won, total: stats.total })}
          />
          <StatCard
            label={t("dashboard.exec.qualifiedRate")}
            value={stats.total > 0 ? formatPercent(stats.qualified / stats.total, locale) : "—"}
            sublabel={t("dashboard.exec.qualifiedRateSub", { qualified: stats.qualified })}
          />
        </div>
      </section>

      {readiness ? (
        <section aria-label={t("dashboard.readiness.aria")} className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t("dashboard.readiness.title")}
          </h2>
          <GoLiveReadinessPanel readiness={readiness} canManage={canManage} />
        </section>
      ) : null}

      {readiness ? (
        <section aria-label={t("dashboard.integrationHealth.aria")} className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t("dashboard.integrationHealth.title")}
          </h2>
          <IntegrationHealth whatsapp={whatsapp} calendar={calendar} />
        </section>
      ) : null}

      <section aria-label={t("dashboard.pipeline.aria")} className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("dashboard.pipeline.title")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label={t("dashboard.stats.totalLeads")} value={stats.total} />
          <StatCard label={t("dashboard.stats.qualified")} value={stats.qualified} />
          <StatCard label={t("dashboard.pipeline.won")} value={stats.won} />
          <StatCard label={t("dashboard.stats.hot")} value={stats.hot} accent="hot" />
          <StatCard label={t("dashboard.stats.warm")} value={stats.warm} accent="warm" />
          <StatCard label={t("dashboard.stats.cold")} value={stats.cold} accent="cold" />
        </div>
      </section>

      <section aria-label={t("dashboard.ariaLeadHealth")} className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("dashboard.leadHealthTitle")}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:max-w-2xl">
          <StatCard
            label={t("insights.filter.needsAttention")}
            value={insightSummary.needsAttention}
            accent={insightSummary.needsAttention > 0 ? "warm" : "default"}
            href="/dashboard/leads?focus=needs_attention"
          />
          <StatCard
            label={t("insights.filter.atRisk")}
            value={insightSummary.atRisk}
            accent={insightSummary.atRisk > 0 ? "hot" : "default"}
            href="/dashboard/leads?focus=at_risk"
          />
          <StatCard
            label={t("insights.filter.noAction")}
            value={insightSummary.noActionNeeded}
            href="/dashboard/leads?focus=no_action"
          />
        </div>
      </section>

      <section aria-label={t("dashboard.workload.title")} className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("dashboard.workload.title")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
          <StatCard
            label={t("dashboard.workload.pendingFollowUps")}
            value={followUps.pending}
          />
          <StatCard
            label={t("dashboard.workload.failedFollowUps")}
            value={followUps.failed}
            accent={followUps.failed > 0 ? "hot" : "default"}
          />
        </div>
      </section>

      <section aria-label={t("dashboard.activity.aria")} className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("dashboard.activity.title")}</h2>
        {activity.length === 0 ? (
          <EmptyState
            title={t("dashboard.activity.emptyTitle")}
            hint={t("dashboard.activity.emptyHint")}
          />
        ) : (
          <ActivityFeed events={activity} />
        )}
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
