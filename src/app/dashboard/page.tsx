import type { Metadata } from "next";
import Link from "next/link";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { getIndustryTemplate } from "@/lib/config";
import { loadStoredConfig } from "@/lib/config/organization-config.server";
import { createClient } from "@/lib/supabase/server";
import { getConnectionView } from "@/lib/calendar/connections";
import { getWhatsAppConnectionView } from "@/lib/whatsapp/connections";
import { getWidgetSettings } from "@/lib/org/widget";
import { computeGoLiveReadiness } from "@/lib/org/readiness";
import {
  currentBusinessHour,
  greetingPeriod,
  resolveDisplayName,
} from "@/lib/org/display-name";
import {
  attachInsights,
  getDashboardTrends,
  getFollowUpCounts,
  getInsightSummary,
  getLeadStats,
  getRecentActivity,
  getRecentLeads,
  getRecoveryCandidates,
  getUpcomingAppointmentCount,
  type TrendValue,
} from "@/lib/leads/queries";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Panel, PanelAction } from "@/components/dashboard/panel";
import { WorkflowMap, type WorkflowNode } from "@/components/dashboard/workflow-map";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { GoLiveReadinessPanel } from "@/components/dashboard/readiness";
import { IntegrationHealth } from "@/components/dashboard/integration-health";
import {
  RecentLeadsTable,
  type RecentLeadRow,
} from "@/components/dashboard/recent-leads-table";
import { EmptyState } from "@/components/dashboard/states";
import {
  ActivityIcon,
  AppointmentIcon,
  HandoffIcon,
  HealthIcon,
  LeadsIcon,
  NextActionIcon,
  OpportunityIcon,
  QualifyIcon,
  ReadinessIcon,
  SourceIcon,
  WorkflowIcon,
} from "@/components/icons";
import { formatPercent } from "@/lib/leads/format";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.overview };
}

/** This week's new items minus last week's. */
function delta(t: TrendValue): number {
  return t.current - t.previous;
}

export default async function DashboardOverviewPage() {
  const { user, membership } = await requireOrganizationContext();
  const { t, locale } = await getI18n();
  const template = getIndustryTemplate(membership.industryTemplateId);
  const canManage = canManageConfig(membership.role);

  const supabase = await createClient();

  const [
    stats,
    trends,
    recent,
    followUps,
    appointmentCount,
    insightSummary,
    recoveryCandidates,
    activity,
    storedConfig,
    whatsapp,
    calendar,
    widget,
  ] = await Promise.all([
    getLeadStats(membership.organizationId),
    getDashboardTrends(membership.organizationId),
    getRecentLeads(membership.organizationId, 6),
    getFollowUpCounts(membership.organizationId),
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
    canManage
      ? getWidgetSettings(supabase, membership.organizationId)
      : Promise.resolve(null),
  ]);

  const recentInsights = await attachInsights(membership.organizationId, recent);
  const recentRows: RecentLeadRow[] = recent.map((lead) => {
    const ins = recentInsights.get(lead.id);
    return {
      id: lead.id,
      name: lead.name,
      source: lead.source,
      status: lead.status,
      temperature: lead.temperature,
      createdAt: lead.createdAt,
      riskLevel: ins?.riskLevel,
      action: ins?.action,
    };
  });

  const recoveryCount = recoveryCandidates.length;
  const isEmptyWorkspace = stats.total === 0;
  const conversion =
    stats.total > 0 ? formatPercent(stats.won / stats.total, locale) : "—";
  const trendLabel = t("dashboard.kpi.trendLabel");

  const workflowNodes: WorkflowNode[] = [
    {
      key: "source",
      icon: SourceIcon,
      iconTone: "sky",
      label: t("dashboard.workflow.nodes.source"),
      value: stats.total,
      caption: t("dashboard.workflow.nodes.sourceSub", { count: stats.createdToday }),
      href: "/dashboard/leads",
      tone: stats.total > 0 ? "active" : "neutral",
    },
    {
      key: "qualify",
      icon: QualifyIcon,
      iconTone: "emerald",
      label: t("dashboard.workflow.nodes.qualify"),
      value: stats.qualified,
      caption: t("dashboard.workflow.nodes.qualifySub", { count: stats.total }),
      href: "/dashboard/leads?status=qualified",
      tone: "active",
      badge: { text: t("dashboard.workflow.aiActive"), tone: "ok" },
    },
    {
      key: "opportunity",
      icon: OpportunityIcon,
      iconTone: "indigo",
      label: t("dashboard.workflow.nodes.opportunity"),
      value: stats.hot,
      caption: t("dashboard.workflow.nodes.opportunitySub"),
      href: "/dashboard/leads?temp=hot",
      tone: stats.hot > 0 ? "active" : "neutral",
      badge:
        insightSummary.atRisk > 0
          ? {
              text: t("dashboard.workflow.atRisk", { count: insightSummary.atRisk }),
              tone: "warn",
            }
          : undefined,
    },
    {
      key: "nextAction",
      icon: NextActionIcon,
      iconTone: "violet",
      label: t("dashboard.workflow.nodes.nextAction"),
      value: insightSummary.needsAttention,
      caption: t("dashboard.workflow.nodes.nextActionSub"),
      href: "/dashboard/leads?focus=needs_attention",
      tone: insightSummary.needsAttention > 0 ? "attention" : "neutral",
      badge:
        insightSummary.needsAttention > 0
          ? { text: t("dashboard.workflow.inProgress"), tone: "info" }
          : undefined,
    },
    {
      key: "followUp",
      icon: AppointmentIcon,
      iconTone: "indigo",
      label: t("dashboard.workflow.nodes.followUp"),
      value: appointmentCount,
      caption: t("dashboard.workflow.nodes.followUpSub", { count: followUps.pending }),
      href: "/dashboard/appointments",
      tone: followUps.dueNow > 0 ? "attention" : "neutral",
      badge:
        followUps.dueNow > 0
          ? { text: t("dashboard.workflow.dueNow", { count: followUps.dueNow }), tone: "warn" }
          : undefined,
    },
    {
      key: "handoff",
      icon: HandoffIcon,
      iconTone: "rose",
      label: t("dashboard.workflow.nodes.handoff"),
      value: recoveryCount,
      caption: t("dashboard.workflow.nodes.handoffSub"),
      href: "/dashboard/recovery",
      tone: recoveryCount > 0 ? "attention" : "neutral",
      badge:
        recoveryCount > 0
          ? { text: t("dashboard.workflow.takeAction"), tone: "danger" }
          : undefined,
    },
  ];

  const readiness = canManage
    ? computeGoLiveReadiness({
        templateValid: template !== undefined,
        hasCustomConfig:
          storedConfig !== null && Object.keys(storedConfig).length > 0,
        whatsappStatus: whatsapp?.status ?? null,
        whatsappLastError: whatsapp?.lastError ?? null,
        calendarStatus: calendar?.status ?? null,
        calendarLastError: calendar?.lastError ?? null,
        calendarWorkingDays: calendar?.settings.workingDays ?? [],
      })
    : null;

  const period = greetingPeriod(currentBusinessHour());
  const name = resolveDisplayName(user);
  const greeting = name
    ? t(`dashboard.greeting.${period}Named`, { name })
    : t(`dashboard.greeting.${period}`);

  return (
    <div className="space-y-4">
      <GreetingHeader
        greeting={greeting}
        subtitle={t("dashboard.greeting.subtitle")}
        quote={t("dashboard.greeting.quote")}
        quoteAttribution={t("brand.name")}
      />

      {isEmptyWorkspace ? (
        <section className="rounded-2xl border border-border bg-surface p-5">
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

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={LeadsIcon}
          tone="indigo"
          title={t("dashboard.kpi.totalLeads")}
          value={stats.total}
          trend={{ delta: delta(trends.leads), label: trendLabel }}
          href="/dashboard/leads"
        />
        <KpiCard
          icon={QualifyIcon}
          tone="emerald"
          title={t("dashboard.kpi.qualifiedLeads")}
          value={stats.qualified}
          trend={{ delta: delta(trends.qualified), label: trendLabel }}
          href="/dashboard/leads?status=qualified"
        />
        <KpiCard
          icon={AppointmentIcon}
          tone="sky"
          title={t("dashboard.kpi.appointments")}
          value={appointmentCount}
          trend={{ delta: delta(trends.appointments), label: trendLabel }}
          href="/dashboard/appointments"
        />
        <KpiCard
          icon={OpportunityIcon}
          tone="amber"
          title={t("dashboard.kpi.conversion")}
          value={conversion}
          sublabel={t("dashboard.kpi.conversionSub", {
            won: stats.won,
            total: stats.total,
          })}
        />
      </div>

      {/* Automation Flow — the centerpiece */}
      <Panel
        icon={WorkflowIcon}
        emphasis
        title={t("dashboard.workflow.title")}
        subtitle={t("dashboard.workflow.subtitle")}
        bodyClassName="p-3"
        action={
          <PanelAction href="/dashboard/leads">
            {t("dashboard.workflow.viewDetails")}
          </PanelAction>
        }
      >
        <WorkflowMap nodes={workflowNodes} ariaLabel={t("dashboard.workflow.aria")} />
      </Panel>

      {/* Operational two-column (single column when there's no integration panel) */}
      <div
        className={`grid gap-4 ${canManage ? "lg:grid-cols-2 lg:items-start" : ""}`}
      >
        <Panel
          icon={ActivityIcon}
          tone="sky"
          title={t("dashboard.activity.title")}
          subtitle={t("dashboard.activity.subtitle")}
          bodyClassName="p-0"
          action={
            activity.length > 0 ? (
              <PanelAction href="/dashboard/activity">
                {t("common.viewAll")}
              </PanelAction>
            ) : undefined
          }
        >
          {activity.length === 0 ? (
            <div className="p-2">
              <EmptyState
                title={t("dashboard.activity.emptyTitle")}
                hint={t("dashboard.activity.emptyHint")}
              />
            </div>
          ) : (
            <ActivityFeed events={activity} max={5} />
          )}
        </Panel>

        {canManage ? (
          <Panel
            id="integration-health"
            icon={HealthIcon}
            tone="emerald"
            title={t("dashboard.integrationHealth.title")}
            subtitle={t("dashboard.integrationHealth.subtitle")}
            bodyClassName="p-0"
          >
            <IntegrationHealth
              whatsapp={whatsapp}
              calendar={calendar}
              widget={{
                enabled: widget?.enabled ?? false,
                allowedOrigins: widget?.allowedOrigins.length ?? 0,
              }}
              canManage={canManage}
            />
          </Panel>
        ) : null}
      </div>

      {/* Recent leads */}
      <Panel
        icon={LeadsIcon}
        title={t("dashboard.recentLeads")}
        subtitle={t("dashboard.recentLeadsSubtitle")}
        bodyClassName="p-0"
        action={
          <PanelAction href="/dashboard/leads">
            {t("dashboard.viewAllLeads")}
          </PanelAction>
        }
      >
        {recentRows.length === 0 ? (
          <div className="p-2">
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
          </div>
        ) : (
          <RecentLeadsTable rows={recentRows} />
        )}
      </Panel>

      {readiness ? (
        <Panel
          id="go-live-readiness"
          icon={ReadinessIcon}
          tone="emerald"
          title={t("dashboard.readiness.title")}
          subtitle={t("dashboard.readiness.subtitle")}
          bodyClassName="p-0"
        >
          <GoLiveReadinessPanel readiness={readiness} canManage={canManage} />
        </Panel>
      ) : null}
    </div>
  );
}
