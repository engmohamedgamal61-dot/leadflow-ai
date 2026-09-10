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
  ACTIVITY_FEED_LIMIT,
  countAppointments,
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
  INSIGHT_CANDIDATE_LEADS_LIMIT,
  listAppointments,
  listOpenFollowUps,
  lookupLeadsByField,
  searchLeadsFiltered,
  type LeadQueryFilters,
  type LeadSearchSort,
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
  type LeadCard,
} from "./ranking.ts";
import {
  LEAD_LOOKUP_MAX_CANDIDATES,
  priorityRankingApplies,
  resolveTimeRange,
  type LeadFilters,
  type PlannedOperation,
  type TimeRangeKey,
} from "./plan.ts";
import { emptyView, type ExecutedOperation, type ResultAccuracy } from "./grounding.ts";

const tEn = createTranslator(en);

const FOLLOWUP_SCAN_CAP = 100;

const PROXY_STALE_WARNING =
  "'stale_for' matches leads whose LEAD RECORD has not been updated (updated_at) for that long. It is NOT evidence that no one contacted, called or messaged the lead — only that the record shows no recent change.";

export interface ExecutionContext {
  organizationId: string;
  now: Date;
  /** Lead-field keys from the org's EffectiveConfig — the only keys a `custom` filter may target. */
  customFieldKeys: ReadonlySet<string>;
}

/** Build an outcome with sane defaults for the data-quality fields. */
function outcome(
  o: Omit<ExecutedOperation, "accuracy" | "warnings" | "assumptions"> & {
    accuracy?: ResultAccuracy;
    warnings?: string[];
    assumptions?: string[];
  },
): ExecutedOperation {
  return {
    ...o,
    accuracy: o.accuracy ?? "exact",
    warnings: o.warnings ?? [],
    assumptions: o.assumptions ?? [],
  };
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
  if (f.staleFor !== "all_time") {
    bits.push(`lead record not updated for ${rangeLabel(f.staleFor)} (updated_at proxy)`);
  }
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
  const staleQuery = op.filters.staleFor !== "all_time";
  const usePriority = priorityRankingApplies({
    sort: op.sort,
    hasCustomFilter: query.custom !== null,
    staleFor: op.filters.staleFor,
  });
  let sortNote: string = op.sort;
  let cards: LeadCard[];
  let priorityCandidateCount = 0;

  if (usePriority) {
    const created = resolveTimeRange(op.filters.createdWithin, ctx.now);
    const search = op.filters.search?.toLowerCase() ?? null;
    const srcSet = new Set(op.filters.source.map((s) => s.toLowerCase()));

    const scanned = await getLeadInsightCandidates(ctx.organizationId, ctx.now);
    priorityCandidateCount = scanned.length;
    const candidates = scanned.filter((c) => {
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
    // A deterministic DB sort. `priority_desc` can't be honoured directly:
    //  - a `stale_for` query → oldest last-update first (longest "gone quiet"),
    //    because the priority scan only sees recently-updated leads;
    //  - otherwise (a custom_data filter) → by lead score.
    // Any explicit sort the planner asked for is passed straight through.
    const dbSort: LeadSearchSort =
      op.sort === "priority_desc"
        ? staleQuery
          ? "updated_asc"
          : "score_desc"
        : op.sort;
    if (op.sort === "priority_desc") {
      sortNote = staleQuery
        ? "updated_asc — longest-quiet first (priority ranking cannot rank a staleness query)"
        : "score_desc (priority ranking unavailable with a custom-field filter)";
    }
    const rows = await searchLeadsFiltered(ctx.organizationId, query, {
      sort: dbSort,
      limit: op.limit,
    });
    cards = rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      temperature: r.temperature,
      score: r.score,
      reasonKey: null,
      reasonParams: undefined,
      tag: null,
      href: `/dashboard/leads/${r.id}`,
    }));
  }

  const totalMatching = await countLeadsFiltered(ctx.organizationId, query);

  const warnings: string[] = [];
  const assumptions: string[] = [];
  let accuracy: ResultAccuracy = "exact";

  if (staleQuery) {
    accuracy = "proxy";
    warnings.push(PROXY_STALE_WARNING);
  }
  if (usePriority && priorityCandidateCount >= INSIGHT_CANDIDATE_LEADS_LIMIT) {
    if (accuracy === "exact") accuracy = "partial";
    warnings.push(
      `Priority ranking considered only the ${INSIGHT_CANDIDATE_LEADS_LIMIT} most-recently-updated open leads; some leads outside that window are not ranked.`,
    );
  }
  if (!usePriority && op.sort === "priority_desc") {
    assumptions.push(
      staleQuery
        ? "Priority ranking cannot rank a staleness query, so results are ordered by how long each lead's record has gone without an update (longest first)."
        : "Priority ranking is unavailable with this filter set, so results are ordered by lead score instead.",
    );
  }
  if (totalMatching > cards.length) {
    assumptions.push(
      `${totalMatching} leads match; only the top ${cards.length} are shown.`,
    );
  }

  return outcome({
    type: "lead_search",
    label: `${filterSummary(op.filters, dropped)}; sorted ${sortNote}; limit ${op.limit}`,
    accuracy,
    warnings,
    assumptions,
    data: {
      returned_count: cards.length,
      total_count: totalMatching,
      showing_all: totalMatching <= cards.length,
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
    // Never say "no data" when the exact count proves matches exist: a near-empty
    // sample slice must still reach the grounded answer so the real total and the
    // proxy caveat are disclosed.
    empty: cards.length === 0 && totalMatching === 0,
    view: { ...emptyView(), leads: cards },
  });
}

async function runLeadCount(
  op: Extract<PlannedOperation, { type: "lead_count" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const { query, dropped } = toQueryFilters(op.filters, ctx);
  const count = await countLeadsFiltered(ctx.organizationId, query);
  const proxy = op.filters.staleFor !== "all_time";
  return outcome({
    type: "lead_count",
    label: filterSummary(op.filters, dropped),
    accuracy: proxy ? "proxy" : "exact",
    warnings: proxy ? [PROXY_STALE_WARNING] : [],
    data: { count },
    empty: count === 0,
    view: { ...emptyView(), metrics: [{ key: "totalLeads", value: count }] },
  });
}

async function runLeadCountGrouped(
  op: Extract<PlannedOperation, { type: "lead_count_grouped" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const window = resolveTimeRange(op.timeRange, ctx.now);
  if (op.groupBy === "status") {
    const { total, byStatus } = await getLeadStatusCounts(ctx.organizationId, window);
    return outcome({
      type: "lead_count_grouped",
      label: `by status, ${rangeLabel(op.timeRange)}`,
      data: { total, by_status: byStatus },
      empty: total === 0,
      view: { ...emptyView(), metrics: leadStatusMetrics(byStatus, total) },
    });
  }
  if (op.groupBy === "opportunity") {
    const counts = await getOpportunityCounts(ctx.organizationId, window);
    return outcome({
      type: "lead_count_grouped",
      label: `by opportunity level, ${rangeLabel(op.timeRange)}`,
      data: { total: counts.total, hot: counts.hot, warm: counts.warm, cold: counts.cold },
      empty: counts.total === 0,
      view: { ...emptyView(), metrics: opportunityMetrics(counts, counts.total) },
    });
  }
  const { rows, scanned, capped } = await getLeadSourceCounts(ctx.organizationId, window);
  const total = rows.reduce((s, r) => s + r.count, 0);
  return outcome({
    type: "lead_count_grouped",
    label: `by source, ${rangeLabel(op.timeRange)}`,
    accuracy: capped ? "partial" : "exact",
    warnings: capped
      ? [
          `Source breakdown is based on the ${scanned} most recent leads (the scan cap), not the whole workspace — the true totals per source may be higher.`,
        ]
      : [],
    data: {
      total,
      scanned,
      complete: !capped,
      by_source: rows.map((r) => ({ source: r.source ?? "unknown", count: r.count })),
    },
    empty: total === 0,
    view: { ...emptyView(), metrics: leadSourceMetrics(rows) },
  });
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
  return outcome({
    type: "pipeline_metrics",
    label: "current pipeline snapshot",
    assumptions: [
      `needs_attention / at_risk / recovery_opportunities are computed from the ${INSIGHT_CANDIDATE_LEADS_LIMIT} most-recently-updated open leads.`,
    ],
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
  });
}

/** qualified / won are derived from status-change events; new_leads / appointments from row created_at. */
const EVENT_DERIVED_COMPARE = new Set(["qualified", "won"]);

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
  const eventDerived = EVENT_DERIVED_COMPARE.has(op.metric);
  return outcome({
    type: "compare_periods",
    label: `${op.metric.replace(/_/g, " ")}: this ${op.period} vs previous ${op.period}`,
    accuracy: eventDerived ? "proxy" : "exact",
    warnings: eventDerived
      ? [
          `"${op.metric}" is counted from recorded status-change events. If a status change was not logged as an event, it is not in these counts.`,
        ]
      : [],
    assumptions: [
      "This compares counts between two time windows only. It is NOT an explanation of why the numbers differ — never state a cause unless another result in this data set directly supports it.",
    ],
    data: {
      metric: op.metric,
      period: op.period,
      current,
      previous,
      change: delta,
      change_pct: `${deltaPct > 0 ? "+" : ""}${deltaPct}%`,
    },
    empty: current === 0 && previous === 0,
    view: {
      ...emptyView(),
      metrics: [
        { key: op.metric === "new_leads" ? "newLeads" : op.metric, value: current, delta },
      ],
    },
  });
}

async function runAppointmentSearch(
  op: Extract<PlannedOperation, { type: "appointment_search" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  // The `when` filter is applied in SQL before the row limit, so a "past" query
  // is never crowded out by upcoming rows. `total` is an exact head-count.
  const [rows, total] = await Promise.all([
    listAppointments(ctx.organizationId, {
      when: op.when,
      status: op.status,
      limit: op.limit,
      now: ctx.now,
    }),
    countAppointments(ctx.organizationId, {
      when: op.when,
      status: op.status,
      now: ctx.now,
    }),
  ]);
  const cards = rows.slice(0, op.limit).map((a) => ({
    id: a.id,
    leadId: a.leadId,
    leadName: a.leadName,
    startsAt: a.startsAt,
    status: a.status,
    href: `/dashboard/leads/${a.leadId}`,
  }));
  const order =
    op.when === "past" ? "most recent first" : op.when === "all" ? "upcoming first" : "soonest first";
  return outcome({
    type: "appointment_search",
    label: `${op.when}${op.status.length ? `, status ${op.status.join("|")}` : ""}; limit ${op.limit}`,
    accuracy: "exact",
    assumptions:
      total > cards.length
        ? [`${total} appointments match; showing ${cards.length} (${order}).`]
        : [],
    data: {
      returned_count: cards.length,
      total_count: total,
      showing_all: total <= cards.length,
      appointments: cards.map((c) => ({
        lead: c.leadName?.trim() || "(unnamed lead)",
        status: c.status,
        starts_at: c.startsAt,
      })),
    },
    empty: cards.length === 0 && total === 0,
    view: { ...emptyView(), appointments: cards },
  });
}

async function runAppointmentCount(
  op: Extract<PlannedOperation, { type: "appointment_count" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  // "upcoming, any status" = the active upcoming count on the dashboard card
  // (scheduled / rescheduled only). Every other combination is an exact
  // `count: "exact"` head-count over the `when` window — never a capped scan.
  const count =
    op.when === "upcoming" && op.status.length === 0
      ? await getUpcomingAppointmentCount(ctx.organizationId)
      : await countAppointments(ctx.organizationId, {
          when: op.when,
          status: op.status,
          now: ctx.now,
        });
  return outcome({
    type: "appointment_count",
    label: `${op.when}${op.status.length ? `, status ${op.status.join("|")}` : ""}`,
    accuracy: "exact",
    data: { count, exact: true, when: op.when },
    empty: count === 0,
    view: {
      ...emptyView(),
      metrics: [
        {
          key: op.when === "upcoming" ? "upcomingAppointments" : "appointmentsBooked",
          value: count,
        },
      ],
    },
  });
}

async function runFollowupSearch(
  op: Extract<PlannedOperation, { type: "followup_search" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const open = await listOpenFollowUps(ctx.organizationId, FOLLOWUP_SCAN_CAP, ctx.now);
  const scanCapped = open.length >= FOLLOWUP_SCAN_CAP;
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
  return outcome({
    type: "followup_search",
    label: `state ${op.state}; limit ${op.limit}`,
    accuracy: scanCapped ? "partial" : "exact",
    warnings: scanCapped
      ? [`Only the ${FOLLOWUP_SCAN_CAP} soonest open follow-ups were scanned — there may be more.`]
      : [],
    assumptions:
      matched.length > cards.length
        ? [`${matched.length} follow-ups match; showing the first ${cards.length}.`]
        : [],
    data: {
      returned_count: cards.length,
      total_count: scanCapped ? `at least ${matched.length}` : matched.length,
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
  });
}

/** Shared detail shaping for `lead_details` and a unique `lead_lookup` match. */
async function buildLeadDetailOutcome(
  leadId: string,
  ctx: ExecutionContext,
  type: "lead_details" | "lead_lookup",
): Promise<ExecutedOperation | null> {
  const detail = await getLeadDetail(ctx.organizationId, leadId);
  if (!detail) return null;
  const r = detail.record;
  const leadName = r.lead.name?.trim() || null;
  const temperature = String(r.temperature).toLowerCase();
  const events = detail.events.slice(-6).map((e) => ({ event: e.eventType, at: e.createdAt }));
  const nextAppt = detail.appointments
    .filter((a) => Date.parse(a.startsAt) >= ctx.now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return outcome({
    type,
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
  });
}

async function runLeadDetails(
  op: Extract<PlannedOperation, { type: "lead_details" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const built = await buildLeadDetailOutcome(op.leadId, ctx, "lead_details");
  return (
    built ??
    outcome({
      type: "lead_details",
      label: "one lead",
      data: { found: false, note: "No lead with that id exists in this workspace." },
      empty: true,
      view: emptyView(),
    })
  );
}

async function runLeadLookup(
  op: Extract<PlannedOperation, { type: "lead_lookup" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const rows = await lookupLeadsByField(
    ctx.organizationId,
    op.by,
    op.value,
    LEAD_LOOKUP_MAX_CANDIDATES,
  );

  // Exactly one → resolve to full details (no separate lead_details needed).
  if (rows.length === 1) {
    const built = await buildLeadDetailOutcome(rows[0].id, ctx, "lead_lookup");
    if (built) {
      return {
        ...built,
        label: `resolved ${op.by} "${op.value}" → 1 lead`,
        data: { ...built.data, resolution: "unique" },
      };
    }
  }

  if (rows.length === 0) {
    return outcome({
      type: "lead_lookup",
      label: `${op.by} "${op.value}"`,
      data: {
        resolution: "not_found",
        note: `No lead in this workspace matches that ${op.by}. Tell the user it wasn't found — do not guess.`,
      },
      empty: true,
      view: emptyView(),
    });
  }

  // 2+ matches → hand back safe identifying fields; the answer asks which one.
  const candidates = rows.map((r) => ({
    name: r.name?.trim() || "(unnamed lead)",
    status: r.status,
    opportunity: String(r.temperature).toLowerCase(),
    source: r.source ?? "unknown",
    created: r.createdAt.slice(0, 10),
  }));
  return outcome({
    type: "lead_lookup",
    label: `${op.by} "${op.value}" → ${rows.length} matches`,
    data: {
      resolution: "ambiguous",
      match_count: rows.length,
      capped: rows.length >= LEAD_LOOKUP_MAX_CANDIDATES,
      candidates,
      note: "MULTIPLE leads match. Ask the user which one they mean, listing the candidates by name plus one distinguishing detail. Do NOT pick one yourself and do NOT show any id.",
    },
    empty: false,
    view: {
      ...emptyView(),
      leads: rows.map((r) => ({
        id: r.id,
        name: r.name?.trim() || null,
        status: r.status,
        temperature: String(r.temperature).toLowerCase(),
        score: r.score,
        reasonKey: null,
        reasonParams: undefined,
        tag: null,
        href: `/dashboard/leads/${r.id}`,
      })),
    },
  });
}

async function runConversionSummary(
  op: Extract<PlannedOperation, { type: "conversion_summary" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const window = resolveTimeRange(op.timeRange, ctx.now);
  const stats = await getConversionStats(ctx.organizationId, window);
  const decided = stats.won + stats.lost;
  return outcome({
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
  });
}

async function runActivitySearch(
  op: Extract<PlannedOperation, { type: "activity_search" }>,
  ctx: ExecutionContext,
): Promise<ExecutedOperation> {
  const window = resolveTimeRange(op.timeRange, ctx.now);
  const raw = await getRecentActivity(ctx.organizationId, op.limit);
  const feedCapped = raw.length >= Math.min(op.limit, ACTIVITY_FEED_LIMIT);
  const events = raw.filter((e) =>
    op.timeRange === "all_time" ? true : inRange(e.createdAt, window.from, window.to),
  );
  // The feed itself is bounded — if it came back full AND nothing was filtered
  // out by the time window, older events in the window may be missing.
  const windowIncomplete = feedCapped && events.length === raw.length && op.timeRange !== "all_time";
  return outcome({
    type: "activity_search",
    label: `${rangeLabel(op.timeRange)}; limit ${op.limit}`,
    accuracy: feedCapped ? "partial" : "exact",
    warnings: feedCapped
      ? [
          `The activity feed returns at most ${ACTIVITY_FEED_LIMIT} recent events. ${
            windowIncomplete
              ? "Older events inside the requested window are not included."
              : "This is the newest activity, not necessarily every event."
          }`,
        ]
      : [],
    data: {
      returned_count: events.length,
      complete: !feedCapped,
      events: events.map((e) => ({
        type: e.eventType,
        lead: e.leadName?.trim() || "(unnamed lead)",
        at: e.createdAt,
      })),
    },
    empty: events.length === 0,
    view: { ...emptyView(), activity: events },
  });
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
    case "lead_lookup":
      return runLeadLookup(op, ctx);
    case "lead_details":
      return runLeadDetails(op, ctx);
    case "conversion_summary":
      return runConversionSummary(op, ctx);
    case "activity_search":
      return runActivitySearch(op, ctx);
  }
}
