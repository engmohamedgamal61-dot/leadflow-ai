/**
 * Ask LeadFlow — deterministic execution of a validated {@link QueryPlan}.
 *
 * Server-only. Every operation maps to bounded, tenant-scoped reads that
 * already back the dashboard (`lib/leads/queries.ts`) — all on the
 * request-scoped, RLS-enforced Supabase client with an explicit
 * `organization_id` filter. No AI-generated SQL, no arbitrary table/column
 * names, no writes. `organizationId` always comes from the caller's
 * membership, never from the plan.
 *
 * Each operation returns an {@link ExecutedOperation}: compact structured
 * `data` for the grounded answer + UI `view` cards.
 */

import "server-only";

import {
  countLeadsFiltered,
  getConversionStats,
  getFollowUpCounts,
  getInsightSummary,
  getLeadDetail,
  getLeadInsightCandidates,
  getLeadSourceCounts,
  getLeadStats,
  getLeadStatusCounts,
  getMetricComparison,
  getOpportunityCounts,
  getRecentActivity,
  getRecoveryCandidates,
  getUpcomingAppointmentCount,
  listAppointments,
  listOpenFollowUps,
  searchLeadsFiltered,
  type LeadQueryFilters,
} from "@/lib/leads/queries";
import { en } from "@/i18n/dictionaries/en";
import { createTranslator } from "@/i18n/translate";
import {
  conversionMetrics,
  leadSourceMetrics,
  leadStatusMetrics,
  opportunityMetrics,
  pipelineMetrics,
  rankLeadsByPriority,
  shapeAppointments,
  shapeLeadList,
  type LeadCard,
} from "./ranking.ts";
import {
  resolveTimeRange,
  type LeadFilters,
  type PlannedOperation,
  type TimeRangeKey,
} from "./plan.ts";
import { emptyView, type ExecutedOperation } from "./grounding.ts";

const tEn = createTranslator(en);

export interface ExecutionContext {
  organizationId: string;
  now: Date;
  /** Lead-field keys from the org's EffectiveConfig — the only keys a `custom` filter may target. */
  customFieldKeys: ReadonlySet<string>;
}

function reason(key: string | null, params?: Record<string, string | number>): string | null {
  if (!key) return null;
  const r = tEn(key, params);
  return r && r !== key ? r : null;
}

function rangeLabel(key: TimeRangeKey): string {
  return key === "all_time" ? "all time" : key.replace(/_/g, " ");
}

function filterSummary(f: LeadFilters, dropped: string[]): string {
  const bits: string[] = [];
  if (f.status.length) bits.push(`status=${f.status.join("|")}`);
  if (f.opportunity.length) bits.push(`opportunity=${f.opportunity.join("|")}`);
  if (f.source.length) bits.push(`source=${f.source.join("|")}`);
  if (f.createdWithin !== "all_time") bits.push(`created within ${rangeLabel(f.createdWithin)}`);
  if (f.staleFor !== "all_time") bits.push(`no activity for ${rangeLabel(f.staleFor)}`);
  if (f.search) bits.push(`text "${f.search}"`);
  if (f.custom) bits.push(`${f.custom.key} contains "${f.custom.value}"`);
  for (const d of dropped) bits.push(`(ignored: ${d})`);
  return bits.length ? bits.join(", ") : "no filters";
}

/** Translate a validated plan filter set into a tenant-scoped query filter set. */
function toQueryFilters(
  f: LeadFilters,
  ctx: ExecutionContext,
): { query: LeadQueryFilters; dropped: string[] } {
  const created = resolveTimeRange(f.createdWithin, ctx.now);
  const stale = resolveTimeRange(f.staleFor, ctx.now);
  const dropped: string[] = [];

  let custom: LeadQueryFilters["custom"] = null;
  if (f.custom) {
    if (ctx.customFieldKeys.has(f.custom.key)) custom = f.custom;
    else dropped.push(`unknown field "${f.custom.key}"`);
  }

  return {
    query: {
      status: f.status,
      temperature: f.opportunity,
      source: f.source,
      createdFrom: created.from,
      createdTo: created.to,
      staleBefore: f.staleFor === "all_time" ? null : stale.from,
      search: f.search,
      custom,
    },
    dropped,
  };
}

function inRange(iso: string, from: Date | null, to: Date | null): boolean {
  const t = Date.parse(iso);
  if (from && t < from.getTime()) return false;
  if (to && t >= to.getTime()) return false;
  return true;
}

// ── per-operation executors ──────────────────────────────────────────────────

async function runLeadSearch(
  op: Extract<PlannedOperation, { type: "lead_search" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const { query, dropped } = toQueryFilters(op.filters, ctx);
  const usePriority = op.sort === "priority_desc" && !query.custom;
  let sortNote: string = op.sort;
  let cards: LeadCard[];

  if (usePriority) {
    const created = resolveTimeRange(op.filters.createdWithin, ctx.now);
    const staleFrom =
      op.filters.staleFor === "all_time"
        ? null
        : resolveTimeRange(op.filters.staleFor, ctx.now).from;
    const search = op.filters.search?.toLowerCase() ?? null;
    const srcSet = new Set(op.filters.source.map((s) => s.toLowerCase()));

    const candidates = (
      await getLeadInsightCandidates(ctx.organizationId, ctx.now)
    ).filter((c) => {
      const l = c.lead;
      if (op.filters.status.length && !op.filters.status.includes(l.status)) return false;
      if (
        op.filters.opportunity.length &&
        !op.filters.opportunity.includes(l.temperature)
      ) {
        return false;
      }
      if (srcSet.size && !srcSet.has((l.source ?? "").toLowerCase())) return false;
      if (
        op.filters.createdWithin !== "all_time" &&
        !inRange(l.createdAt, created.from, created.to)
      ) {
        return false;
      }
      if (staleFrom && Date.parse(l.updatedAt) >= staleFrom.getTime()) return false;
      if (
        search &&
        !`${l.name ?? ""} ${l.phone ?? ""} ${l.email ?? ""}`.toLowerCase().includes(search)
      ) {
        return false;
      }
      return true;
    });
    cards = rankLeadsByPriority(candidates, op.limit);
  } else {
    if (op.sort === "priority_desc") sortNote = "score_desc (priority ranking unavailable with this filter)";
    cards = shapeLeadList(
      (
        await searchLeadsFiltered(ctx.organizationId, query, {
          sort:
            op.sort === "priority_desc" || op.sort === "score_desc"
              ? "score_desc"
              : op.sort,
          limit: op.limit,
        })
      ).map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        temperature: r.temperature,
        score: r.score,
        updatedAt: r.updatedAt,
      })),
      op.limit,
    );
  }

  const totalMatching = await countLeadsFiltered(ctx.organizationId, query);

  return {
    type: "lead_search",
    label: `${filterSummary(op.filters, dropped)}; sorted ${sortNote}; limit ${op.limit}`,
    data: {
      matched_shown: cards.length,
      total_matching: totalMatching,
      truncated: totalMatching > cards.length,
      leads: cards.map((c) => ({
        name: c.name?.trim() || "(unnamed lead)",
        status: c.status || "n/a",
        opportunity: c.temperature || "n/a",
        score: c.score,
        ...(usePriority
          ? { reason: reason(c.reasonKey, c.reasonParams) ?? "on track — no action flagged" }
          : {}),
      })),
    },
    empty: cards.length === 0,
    view: { ...emptyView(), leads: cards },
  };
}

async function runLeadCount(
  op: Extract<PlannedOperation, { type: "lead_count" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const { query, dropped } = toQueryFilters(op.filters, ctx);
  const count = await countLeadsFiltered(ctx.organizationId, query);
  return {
    type: "lead_count",
    label: filterSummary(op.filters, dropped),
    data: { count },
    empty: count === 0,
    view: { ...emptyView(), metrics: [{ key: "totalLeads", value: count }] },
  };
}

async function runLeadCountGrouped(
  op: Extract<PlannedOperation, { type: "lead_count_grouped" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const window = resolveTimeRange(op.timeRange, ctx.now);
  if (op.groupBy === "status") {
    const { total, byStatus } = await getLeadStatusCounts(ctx.organizationId, window);
    return {
      type: "lead_count_grouped",
      label: `by status, ${rangeLabel(op.timeRange)}`,
      data: { total, by_status: byStatus },
      empty: total === 0,
      view: { ...emptyView(), metrics: leadStatusMetrics(byStatus, total) },
    };
  }
  if (op.groupBy === "opportunity") {
    const counts = await getOpportunityCounts(ctx.organizationId, window);
    return {
      type: "lead_count_grouped",
      label: `by opportunity level, ${rangeLabel(op.timeRange)}`,
      data: { total: counts.total, hot: counts.hot, warm: counts.warm, cold: counts.cold },
      empty: counts.total === 0,
      view: { ...emptyView(), metrics: opportunityMetrics(counts, counts.total) },
    };
  }
  const rows = await getLeadSourceCounts(ctx.organizationId, window);
  const total = rows.reduce((s, r) => s + r.count, 0);
  return {
    type: "lead_count_grouped",
    label: `by source, ${rangeLabel(op.timeRange)}`,
    data: {
      total,
      by_source: rows.map((r) => ({ source: r.source ?? "unknown", count: r.count })),
    },
    empty: total === 0,
    view: { ...emptyView(), metrics: leadSourceMetrics(rows) },
  };
}

async function runPipelineMetrics(
  op: Extract<PlannedOperation, { type: "pipeline_metrics" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const [stats, insightSummary, followUpCounts, upcomingAppointments, recovery] =
    await Promise.all([
      getLeadStats(ctx.organizationId),
      getInsightSummary(ctx.organizationId),
      getFollowUpCounts(ctx.organizationId),
      getUpcomingAppointmentCount(ctx.organizationId),
      getRecoveryCandidates(ctx.organizationId, ctx.now),
    ]);
  const metrics = pipelineMetrics({
    stats,
    insightSummary,
    followUpCounts,
    upcomingAppointments,
    recoveryOpportunities: recovery.length,
  });
  return {
    type: "pipeline_metrics",
    label: "current pipeline snapshot",
    data: {
      total_leads: stats.total,
      new_today: stats.createdToday,
      by_opportunity: { hot: stats.hot, warm: stats.warm, cold: stats.cold },
      qualified: stats.qualified,
      won: stats.won,
      needs_attention: insightSummary.needsAttention,
      at_risk: insightSummary.atRisk,
      follow_ups_due: followUpCounts.dueNow,
      follow_ups_failed: followUpCounts.failed,
      upcoming_appointments: upcomingAppointments,
      recovery_opportunities: recovery.length,
    },
    empty: stats.total === 0,
    view: { ...emptyView(), metrics },
  };
}

async function runComparePeriods(
  op: Extract<PlannedOperation, { type: "compare_periods" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const { current, previous } = await getMetricComparison(
    ctx.organizationId,
    op.metric,
    op.period,
    ctx.now,
  );
  const delta = current - previous;
  const deltaPct =
    previous > 0 ? Math.round((delta / previous) * 100) : current > 0 ? 100 : 0;
  return {
    type: "compare_periods",
    label: `${op.metric.replace(/_/g, " ")}: this ${op.period} vs previous ${op.period}`,
    data: {
      metric: op.metric,
      period: op.period,
      current,
      previous,
      change: delta,
      change_pct: `${deltaPct > 0 ? "+" : ""}${deltaPct}%`,
      note: "This compares counts between two time windows. It does not explain WHY the numbers differ.",
    },
    empty: current === 0 && previous === 0,
    view: {
      ...emptyView(),
      metrics: [
        { key: op.metric === "new_leads" ? "newLeads" : op.metric, value: current, delta },
      ],
    },
  };
}

function appointmentWhereWhen(
  when: "upcoming" | "past" | "all",
  startsAt: string,
  now: Date,
): boolean {
  if (when === "all") return true;
  const future = Date.parse(startsAt) >= now.getTime();
  return when === "upcoming" ? future : !future;
}

async function runAppointmentSearch(
  op: Extract<PlannedOperation, { type: "appointment_search" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const all = await listAppointments(ctx.organizationId, 60, ctx.now);
  const statusSet = new Set(op.status);
  const matched = all.filter(
    (a) =>
      (statusSet.size === 0 || statusSet.has(a.status as never)) &&
      appointmentWhereWhen(op.when, a.startsAt, ctx.now),
  );
  const cards = shapeAppointments(
    matched.slice(0, op.limit).map((a) => ({
      id: a.id,
      leadId: a.leadId,
      leadName: a.leadName,
      startsAt: a.startsAt,
      status: a.status,
    })),
    op.limit,
  );
  return {
    type: "appointment_search",
    label: `${op.when}${op.status.length ? `, status ${op.status.join("|")}` : ""}; limit ${op.limit}`,
    data: {
      matched_shown: cards.length,
      total_matching: matched.length,
      truncated: all.length === 60,
      appointments: cards.map((c) => ({
        lead: c.leadName?.trim() || "(unnamed lead)",
        status: c.status,
        starts_at: c.startsAt,
      })),
    },
    empty: cards.length === 0,
    view: { ...emptyView(), appointments: cards },
  };
}

async function runAppointmentCount(
  op: Extract<PlannedOperation, { type: "appointment_count" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  if (op.when === "upcoming" && op.status.length === 0) {
    const count = await getUpcomingAppointmentCount(ctx.organizationId);
    return {
      type: "appointment_count",
      label: "upcoming",
      data: { count },
      empty: count === 0,
      view: { ...emptyView(), metrics: [{ key: "upcomingAppointments", value: count }] },
    };
  }
  const all = await listAppointments(ctx.organizationId, 60, ctx.now);
  const statusSet = new Set(op.status);
  const count = all.filter(
    (a) =>
      (statusSet.size === 0 || statusSet.has(a.status as never)) &&
      appointmentWhereWhen(op.when, a.startsAt, ctx.now),
  ).length;
  return {
    type: "appointment_count",
    label: `${op.when}${op.status.length ? `, status ${op.status.join("|")}` : ""}`,
    data: { count, capped_at: all.length === 60 ? 60 : undefined },
    empty: count === 0,
    view: { ...emptyView(), metrics: [{ key: "upcomingAppointments", value: count }] },
  };
}

async function runFollowupSearch(
  op: Extract<PlannedOperation, { type: "followup_search" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const open = await listOpenFollowUps(ctx.organizationId, 100, ctx.now);
  const matched = open.filter((f) => {
    if (op.state === "overdue") return f.overdue;
    if (op.state === "failed") return f.status === "failed";
    if (op.state === "pending") return f.status === "pending";
    return true; // "open" = pending + failed (what listOpenFollowUps returns)
  });
  const cards: LeadCard[] = matched.slice(0, op.limit).map((f) => ({
    id: f.leadId,
    name: f.leadName,
    status: "",
    temperature: "",
    score: 0,
    reasonKey: f.overdue
      ? "askLeadFlow.reasons.followUpOverdue"
      : f.status === "failed"
        ? "askLeadFlow.reasons.followUpFailed"
        : null,
    reasonParams: undefined,
    tag: f.overdue ? "follow_up" : f.status === "failed" ? "failed" : null,
    href: `/dashboard/leads/${f.leadId}`,
  }));
  return {
    type: "followup_search",
    label: `state ${op.state}; limit ${op.limit}`,
    data: {
      matched_shown: cards.length,
      total_matching: matched.length,
      overdue: open.filter((f) => f.overdue).length,
      failed: open.filter((f) => f.status === "failed").length,
      follow_ups: cards.map((c, i) => ({
        lead: c.name?.trim() || "(unnamed lead)",
        due: matched[i]?.scheduledAt,
        state: matched[i]?.overdue ? "overdue" : matched[i]?.status,
      })),
    },
    empty: cards.length === 0,
    view: { ...emptyView(), leads: cards },
  };
}

async function runLeadDetails(
  op: Extract<PlannedOperation, { type: "lead_details" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const detail = await getLeadDetail(ctx.organizationId, op.leadId);
  if (!detail) {
    return {
      type: "lead_details",
      label: "one lead",
      data: { found: false, note: "No lead with that id exists in this workspace." },
      empty: true,
      view: emptyView(),
    };
  }
  const r = detail.record;
  const leadName = r.lead.name?.trim() || null;
  const temperature = String(r.temperature).toLowerCase();
  const events = detail.events
    .slice(-6)
    .map((e) => ({ event: e.eventType, at: e.createdAt }));
  const nextAppt = detail.appointments
    .filter((a) => Date.parse(a.startsAt) >= ctx.now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return {
    type: "lead_details",
    label: `lead "${leadName ?? "(unnamed)"}"`,
    data: {
      found: true,
      name: leadName ?? "(unnamed lead)",
      status: r.status,
      opportunity: temperature,
      score: r.score,
      source: r.source ?? "unknown",
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      open_follow_ups: detail.followUps.filter((f) => f.status === "pending").length,
      next_appointment: nextAppt ? nextAppt.startsAt : null,
      recent_events: events,
      needs_attention: detail.needsAttention,
    },
    empty: false,
    view: {
      ...emptyView(),
      leads: [
        {
          id: r.id,
          name: leadName,
          status: r.status,
          temperature,
          score: r.score,
          reasonKey: null,
          reasonParams: undefined,
          tag: null,
          href: `/dashboard/leads/${r.id}`,
        },
      ],
    },
  };
}

async function runConversionSummary(
  op: Extract<PlannedOperation, { type: "conversion_summary" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const window = resolveTimeRange(op.timeRange, ctx.now);
  const stats = await getConversionStats(ctx.organizationId, window);
  const decided = stats.won + stats.lost;
  return {
    type: "conversion_summary",
    label: rangeLabel(op.timeRange),
    data: {
      total_leads: stats.total,
      qualified: stats.qualified,
      appointment: stats.appointment,
      won: stats.won,
      lost: stats.lost,
      conversion_rate:
        decided > 0 ? `${Math.round((stats.won / decided) * 100)}%` : "n/a (no won/lost leads yet)",
    },
    empty: stats.total === 0,
    view: { ...emptyView(), metrics: conversionMetrics(stats) },
  };
}

async function runActivitySearch(
  op: Extract<PlannedOperation, { type: "activity_search" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const window = resolveTimeRange(op.timeRange, ctx.now);
  const events = (await getRecentActivity(ctx.organizationId, op.limit)).filter((e) =>
    op.timeRange === "all_time" ? true : inRange(e.createdAt, window.from, window.to),
  );
  return {
    type: "activity_search",
    label: `${rangeLabel(op.timeRange)}; limit ${op.limit}`,
    data: {
      events_shown: events.length,
      events: events.map((e) => ({
        type: e.eventType,
        lead: e.leadName?.trim() || "(unnamed lead)",
        at: e.createdAt,
      })),
    },
    empty: events.length === 0,
    view: { ...emptyView(), activity: events },
  };
}

// ── dispatch ─────────────────────────────────────────────────────────────────

export async function executeOperation(
  op: PlannedOperation,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  switch (op.type) {
    case "lead_search":
      return runLeadSearch(op, ctx);
    case "lead_count":
      return runLeadCount(op, ctx);
    case "lead_count_grouped":
      return runLeadCountGrouped(op, ctx);
    case "pipeline_metrics":
      return runPipelineMetrics(op, ctx);
    case "compare_periods":
      return runComparePeriods(op, ctx);
    case "appointment_search":
      return runAppointmentSearch(op, ctx);
    case "appointment_count":
      return runAppointmentCount(op, ctx);
    case "followup_search":
      return runFollowupSearch(op, ctx);
    case "lead_details":
      return runLeadDetails(op, ctx);
    case "conversion_summary":
      return runConversionSummary(op, ctx);
    case "activity_search":
      return runActivitySearch(op, ctx);
  }
}
