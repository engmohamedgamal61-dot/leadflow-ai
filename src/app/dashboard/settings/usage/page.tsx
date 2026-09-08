import type { Metadata } from "next";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/i18n/server";
import type { Locale } from "@/i18n/config";
import {
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
} from "@/i18n/format";
import { UsageIcon } from "@/components/icons";
import { Panel } from "@/components/dashboard/panel";
import { getUsageDashboardData } from "@/lib/metering/queries";
import { NO_LIMITS } from "@/lib/metering/limits";
import type {
  DimensionEvaluation,
  LimitEvaluation,
  UsageDimension,
} from "@/lib/metering/limits";
import type {
  DailyUsagePoint,
  ModelUsage,
  RequestTypeUsage,
} from "@/lib/metering/aggregate";
import { LimitsForm } from "./limits-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.usage };
}

export default async function UsageSettingsPage() {
  const { membership } = await requireOrganizationContext();
  const { t, locale } = await getI18n();
  const canManage = canManageConfig(membership.role);

  const heading = (
    <div>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
        <UsageIcon className="h-6 w-6 shrink-0 text-muted" />
        {t("settingsUsage.title")}
      </h1>
      <p className="mt-1 text-sm text-muted">{t("settingsUsage.subtitle")}</p>
    </div>
  );

  // Billing/cost data is owner/admin only — RLS enforces it too, this is the
  // friendly gate for a direct URL visit by another role.
  if (!canManage) {
    return (
      <div className="space-y-6">
        {heading}
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-sm text-muted">
          {t("settingsUsage.noAccess")}
        </p>
      </div>
    );
  }

  const db = await createClient();
  const { aggregate, limits, evaluation } = await getUsageDashboardData(
    db,
    membership.organizationId,
  );
  const month = aggregate.currentMonth;
  const prev = aggregate.previousMonth;

  return (
    <div className="space-y-6">
      {heading}

      {/* ── Banner for a triggered limit ─────────────────────────────── */}
      <LimitBanner evaluation={evaluation} t={t} />

      {/* ── KPI row ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label={t("settingsUsage.kpi.estimatedCost")}
          value={formatCurrency(month.totalCostUsd, locale)}
          sub={`${t("settingsUsage.periods.lastMonth")}: ${formatCurrency(prev.totalCostUsd, locale)}`}
        />
        <MetricCard
          label={t("settingsUsage.kpi.totalTokens")}
          value={formatCompactNumber(month.totalTokens, locale)}
          sub={`${t("settingsUsage.kpi.totalRequests")}: ${formatNumber(month.totalRequests, locale)}`}
        />
        <MetricCard
          label={t("settingsUsage.periods.today")}
          value={formatCurrency(aggregate.today.totalCostUsd, locale)}
          sub={`${formatNumber(aggregate.today.totalRequests, locale)} ${t("settingsUsage.kpi.requestsSuffix")}`}
        />
        <MetricCard
          label={t("settingsUsage.kpi.avgCostPerConversation")}
          value={formatCurrency(month.avgCostPerConversation, locale)}
          sub={`${formatNumber(month.distinctConversations, locale)} ${t("settingsUsage.kpi.requestsSuffix")}`}
        />
        <MetricCard
          label={t("settingsUsage.kpi.avgCostPerLead")}
          value={formatCurrency(month.avgCostPerLead, locale)}
          sub={`${formatNumber(month.distinctLeads, locale)} ${t("settingsUsage.kpi.requestsSuffix")}`}
        />
        <MetricCard
          label={`${t("settingsUsage.periods.lastMonth")} · ${t("settingsUsage.kpi.estimatedCost")}`}
          value={formatCurrency(prev.totalCostUsd, locale)}
          sub={`${formatCompactNumber(prev.totalTokens, locale)} ${t("settingsUsage.tokenBreakdown.input").toLowerCase()}/${t("settingsUsage.tokenBreakdown.output").toLowerCase()}`}
        />
      </div>

      {/* ── Token breakdown ──────────────────────────────────────────── */}
      <Panel
        icon={UsageIcon}
        title={t("settingsUsage.tokenBreakdown.title")}
        subtitle={t("settingsUsage.tokenBreakdown.subtitle")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["input", month.inputTokens],
              ["output", month.outputTokens],
              ["cacheRead", month.cacheReadTokens],
              ["cacheWrite", month.cacheCreationTokens],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-[11px] text-muted">
                {t(`settingsUsage.tokenBreakdown.${key}`)}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {formatCompactNumber(value, locale)}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── Limit progress ───────────────────────────────────────────── */}
      <Panel icon={UsageIcon} title={t("settingsUsage.limitProgress.title")}>
        {evaluation.anyLimitConfigured ? (
          <div className="space-y-4">
            {(["cost", "tokens", "requests"] as UsageDimension[])
              .map((d) => evaluation.dimensions[d])
              .filter((d) => d.limit !== null)
              .map((d) => (
                <LimitBar key={d.dimension} d={d} locale={locale} t={t} />
              ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("settingsUsage.limitProgress.noLimits")}</p>
        )}
      </Panel>

      {/* ── Daily trend ──────────────────────────────────────────────── */}
      <Panel
        icon={UsageIcon}
        title={t("settingsUsage.daily.title")}
        subtitle={t("settingsUsage.daily.subtitle")}
      >
        <DailyTrend
          points={aggregate.daily}
          emptyLabel={t("settingsUsage.daily.empty")}
          tooltip={(p) =>
            t("settingsUsage.daily.tooltip", {
              date: formatDate(p.date, locale),
              cost: formatCurrency(p.costUsd, locale),
              requests: formatNumber(p.requests, locale),
            })
          }
        />
      </Panel>

      {/* ── Breakdown tables ─────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel icon={UsageIcon} title={t("settingsUsage.byModel.title")}>
          <BreakdownTable
            rows={aggregate.byModel.map((r: ModelUsage) => ({
              label: r.model,
              requests: r.requests,
              tokens: r.totalTokens,
              cost: r.costUsd,
            }))}
            cols={{
              name: t("settingsUsage.byModel.colModel"),
              requests: t("settingsUsage.byModel.colRequests"),
              tokens: t("settingsUsage.byModel.colTokens"),
              cost: t("settingsUsage.byModel.colCost"),
            }}
            empty={t("settingsUsage.byModel.empty")}
            locale={locale}
          />
        </Panel>

        <Panel icon={UsageIcon} title={t("settingsUsage.byType.title")}>
          <BreakdownTable
            rows={aggregate.byRequestType.map((r: RequestTypeUsage) => ({
              label:
                t(`settingsUsage.byType.types.${r.requestType}`) || r.requestType,
              requests: r.requests,
              tokens: r.totalTokens,
              cost: r.costUsd,
            }))}
            cols={{
              name: t("settingsUsage.byType.colType"),
              requests: t("settingsUsage.byType.colRequests"),
              tokens: t("settingsUsage.byType.colTokens"),
              cost: t("settingsUsage.byType.colCost"),
            }}
            empty={t("settingsUsage.byType.empty")}
            locale={locale}
          />
        </Panel>
      </div>

      {/* ── Limits config ───────────────────────────────────────────── */}
      <Panel
        icon={UsageIcon}
        title={t("settingsUsage.limitsForm.title")}
        subtitle={t("settingsUsage.limitsForm.description")}
      >
        <LimitsForm
          canManage={canManage}
          values={{
            monthlyTokenLimit: (limits ?? NO_LIMITS).monthlyTokenLimit,
            monthlyRequestLimit: (limits ?? NO_LIMITS).monthlyRequestLimit,
            monthlyCostLimitUsd: (limits ?? NO_LIMITS).monthlyCostLimitUsd,
            warningThresholdPercent: (limits ?? NO_LIMITS).warningThresholdPercent,
            hardLimitEnabled: (limits ?? NO_LIMITS).hardLimitEnabled,
          }}
        />
      </Panel>
    </div>
  );
}

type T = (key: string, params?: Record<string, string | number>) => string;

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted/80">{sub}</p> : null}
    </div>
  );
}

function LimitBanner({
  evaluation,
  t,
}: {
  evaluation: LimitEvaluation;
  t: T;
}) {
  if (evaluation.state === "ok") return null;
  const blocked = !evaluation.allowNewRequests;
  const key = blocked
    ? "settingsUsage.limitProgress.blockedBanner"
    : evaluation.hardLimitEnabled
      ? "settingsUsage.limitProgress.warnBanner"
      : evaluation.triggered.some(
            (d) => evaluation.dimensions[d].state === "exceeded",
          )
        ? "settingsUsage.limitProgress.advisoryBanner"
        : "settingsUsage.limitProgress.warnBanner";
  const tone = blocked
    ? "border-rose-300 bg-rose-50 text-rose-700"
    : "border-amber-300 bg-amber-50 text-amber-800";
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
      {t(key)}
    </div>
  );
}

function LimitBar({
  d,
  locale,
  t,
}: {
  d: DimensionEvaluation;
  locale: Locale;
  t: T;
}) {
  const limit = d.limit ?? 0;
  const ratio = d.ratio ?? 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const fmt = (n: number) =>
    d.dimension === "cost"
      ? formatCurrency(n, locale)
      : d.dimension === "tokens"
        ? formatCompactNumber(n, locale)
        : formatNumber(n, locale);
  const barTone =
    d.state === "exceeded"
      ? "bg-rose-500"
      : d.state === "warn"
        ? "bg-amber-500"
        : "bg-emerald-500";
  const stateTone =
    d.state === "exceeded"
      ? "text-rose-600"
      : d.state === "warn"
        ? "text-amber-600"
        : "text-muted";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">
          {t(`settingsUsage.limitProgress.dimensions.${d.dimension}`)}
        </span>
        <span className={`tabular-nums ${stateTone}`}>
          {t("settingsUsage.limitProgress.ofLimit", {
            used: fmt(d.used),
            limit: fmt(limit),
          })}{" "}
          · {formatPercent(ratio, locale)} ·{" "}
          {t(`settingsUsage.limitProgress.state.${d.state}`)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full ${barTone}`}
          style={{ inlineSize: `${Math.max(pct, ratio > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function DailyTrend({
  points,
  emptyLabel,
  tooltip,
}: {
  points: DailyUsagePoint[];
  emptyLabel: string;
  tooltip: (p: DailyUsagePoint) => string;
}) {
  const max = points.reduce((m, p) => Math.max(m, p.costUsd), 0);
  if (max <= 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }
  return (
    <div className="flex h-32 items-end gap-[3px]" role="img">
      {points.map((p) => {
        const h = p.costUsd > 0 ? Math.max(4, Math.round((p.costUsd / max) * 100)) : 1;
        return (
          <div
            key={p.date}
            title={tooltip(p)}
            className="flex-1 rounded-t bg-accent/70 transition-colors hover:bg-accent"
            style={{ blockSize: `${h}%` }}
          />
        );
      })}
    </div>
  );
}

function BreakdownTable({
  rows,
  cols,
  empty,
  locale,
}: {
  rows: { label: string; requests: number; tokens: number; cost: number }[];
  cols: { name: string; requests: string; tokens: string; cost: string };
  empty: string;
  locale: Locale;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-start text-[11px] uppercase tracking-wide text-muted">
            <th className="py-2 pe-3 text-start font-medium">{cols.name}</th>
            <th className="py-2 px-3 text-end font-medium">{cols.requests}</th>
            <th className="py-2 px-3 text-end font-medium">{cols.tokens}</th>
            <th className="py-2 ps-3 text-end font-medium">{cols.cost}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border/60 last:border-0">
              <td className="py-2 pe-3 font-medium text-foreground">{r.label}</td>
              <td className="py-2 px-3 text-end tabular-nums text-muted">
                {formatNumber(r.requests, locale)}
              </td>
              <td className="py-2 px-3 text-end tabular-nums text-muted">
                {formatCompactNumber(r.tokens, locale)}
              </td>
              <td className="py-2 ps-3 text-end tabular-nums text-foreground">
                {formatCurrency(r.cost, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
