/**
 * Ask LeadFlow — the safe, allowlisted data-retrieval layer.
 *
 * Server-only. Every intent maps to a FIXED set of bounded, tenant-scoped
 * reads that already exist for the dashboard (`lib/leads/queries.ts`) — all of
 * which run on the request-scoped, RLS-enforced Supabase client with an
 * explicit `organization_id` filter. The model cannot reach this layer: it is
 * handed the shaped `IntentResult` and asked only to phrase it.
 *
 * `organizationId` always comes from the caller's membership (`actions.ts` /
 * `service.ts`), never from client input.
 */

import "server-only";

import {
  getConversionStats,
  getDashboardTrends,
  getFollowUpCounts,
  getInsightSummary,
  getLeadCount,
  getLeadInsightCandidates,
  getLeadSourceCounts,
  getLeadStats,
  getLeadStatusCounts,
  getOpportunityCounts,
  getRecentActivity,
  getRecoveryCandidates,
  getUpcomingAppointmentCount,
  getUpcomingAppointments,
  listLeadsBrief,
  listOpenFollowUps,
} from "@/lib/leads/queries";
import type { AskIntent } from "./intents.ts";
import {
  DEFAULT_INTENT_PARAMS,
  resolveTimeRange,
  type IntentParams,
} from "./interpretation.ts";
import {
  conversionMetrics,
  filterByRisk,
  followUpCountMetrics,
  isEmptyResult,
  leadSourceMetrics,
  leadStatusMetrics,
  opportunityMetrics,
  pipelineMetrics,
  rankPriorityLeads,
  rankRecovery,
  shapeAppointments,
  shapeLeadList,
  shapeOverdueFollowUps,
  weeklyChangeMetrics,
  type IntentResult,
} from "./ranking.ts";

const RECENT_ACTIVITY_LIMIT = 12;

/** Run one allowlisted intent for an organization. Bounded reads only. */
export async function runIntent(
  intent: AskIntent,
  organizationId: string,
  params: IntentParams = DEFAULT_INTENT_PARAMS,
  now: Date = new Date(),
): Promise<IntentResult> {
  const window = resolveTimeRange(params.timeRange, now);
  const { filters } = params;
  const base = {
    intent,
    metrics: [] as IntentResult["metrics"],
    leads: [] as IntentResult["leads"],
    appointments: [] as IntentResult["appointments"],
    activity: [] as IntentResult["activity"],
  };

  switch (intent) {
    case "total_leads": {
      const count = await getLeadCount(organizationId, {
        status: filters.status,
        temperature: filters.temperature,
        source: filters.source,
        from: window.from,
        to: window.to,
      });
      return finalize({ ...base, metrics: [{ key: "totalLeads", value: count }] });
    }

    case "lead_count_by_status": {
      const { total, byStatus } = await getLeadStatusCounts(organizationId, window);
      return finalize({ ...base, metrics: leadStatusMetrics(byStatus, total) });
    }

    case "lead_count_by_opportunity": {
      const counts = await getOpportunityCounts(organizationId, window);
      return finalize({
        ...base,
        metrics: opportunityMetrics(counts, counts.total),
      });
    }

    case "lead_source_breakdown": {
      const rows = await getLeadSourceCounts(organizationId, window);
      return finalize({ ...base, metrics: leadSourceMetrics(rows) });
    }

    case "qualified_leads": {
      const [rows, count] = await Promise.all([
        listLeadsBrief(organizationId, {
          status: "qualified",
          temperature: filters.temperature,
          source: filters.source,
          from: window.from,
          to: window.to,
          limit: params.limit ?? undefined,
        }),
        getLeadCount(organizationId, {
          status: "qualified",
          temperature: filters.temperature,
          source: filters.source,
          from: window.from,
          to: window.to,
        }),
      ]);
      return finalize({
        ...base,
        leads: shapeLeadList(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            status: r.status,
            temperature: r.temperature,
            score: r.score,
            updatedAt: r.updatedAt,
          })),
          params.limit ?? undefined,
        ),
        metrics: [{ key: "qualified", value: count }],
      });
    }

    case "appointment_count": {
      const [appts, count] = await Promise.all([
        getUpcomingAppointments(organizationId, 12),
        getUpcomingAppointmentCount(organizationId),
      ]);
      return finalize({
        ...base,
        appointments: shapeAppointments(
          appts.map((a) => ({
            id: a.id,
            leadId: a.leadId,
            leadName: a.leadName,
            startsAt: a.startsAt,
            status: a.status,
          })),
        ),
        metrics: [{ key: "upcomingAppointments", value: count }],
      });
    }

    case "follow_up_count": {
      const counts = await getFollowUpCounts(organizationId);
      return finalize({ ...base, metrics: followUpCountMetrics(counts) });
    }

    case "conversion_summary": {
      const stats = await getConversionStats(organizationId, window);
      return finalize({ ...base, metrics: conversionMetrics(stats) });
    }

    case "priority_leads": {
      const candidates = await getLeadInsightCandidates(organizationId, now);
      const needs = candidates.filter((c) => c.insight.riskLevel === "needs_attention").length;
      const risk = candidates.filter((c) => c.insight.riskLevel === "at_risk").length;
      const leads = rankPriorityLeads(candidates);
      return finalize({
        ...base,
        leads,
        metrics: [
          { key: "needsAttention", value: needs },
          { key: "atRisk", value: risk },
          { key: "shown", value: leads.length },
        ],
      });
    }

    case "needs_attention": {
      const candidates = await getLeadInsightCandidates(organizationId, now);
      const leads = filterByRisk(candidates, "needs_attention");
      const total = candidates.filter((c) => c.insight.riskLevel === "needs_attention").length;
      return finalize({
        ...base,
        leads,
        metrics: [{ key: "needsAttention", value: total }],
      });
    }

    case "at_risk_leads": {
      const candidates = await getLeadInsightCandidates(organizationId, now);
      const leads = filterByRisk(candidates, "at_risk");
      const total = candidates.filter((c) => c.insight.riskLevel === "at_risk").length;
      return finalize({
        ...base,
        leads,
        metrics: [{ key: "atRisk", value: total }],
      });
    }

    case "upcoming_appointments": {
      const [appts, count] = await Promise.all([
        getUpcomingAppointments(organizationId, 12),
        getUpcomingAppointmentCount(organizationId),
      ]);
      return finalize({
        ...base,
        appointments: shapeAppointments(
          appts.map((a) => ({
            id: a.id,
            leadId: a.leadId,
            leadName: a.leadName,
            startsAt: a.startsAt,
            status: a.status,
          })),
        ),
        metrics: [{ key: "upcomingAppointments", value: count }],
      });
    }

    case "overdue_followups": {
      const open = await listOpenFollowUps(organizationId, 100, now);
      const { cards, overdueCount, failedCount } = shapeOverdueFollowUps(
        open.map((f) => ({
          id: f.id,
          leadId: f.leadId,
          leadName: f.leadName,
          scheduledAt: f.scheduledAt,
          status: f.status,
          overdue: f.overdue,
        })),
      );
      return finalize({
        ...base,
        leads: cards,
        metrics: [
          { key: "overdueFollowUps", value: overdueCount },
          { key: "failedFollowUps", value: failedCount },
        ],
      });
    }

    case "recovery_opportunities": {
      const candidates = await getRecoveryCandidates(organizationId, now);
      const leads = rankRecovery(
        candidates.map((c) => ({
          lead: {
            id: c.lead.id,
            name: c.lead.name,
            status: c.lead.status,
            temperature: c.lead.temperature,
            score: c.lead.score,
            updatedAt: c.lead.updatedAt,
          },
          candidate: c.candidate,
        })),
      );
      const byPriority = { high: 0, medium: 0, low: 0 } as Record<string, number>;
      for (const c of candidates) byPriority[c.candidate.priority] += 1;
      return finalize({
        ...base,
        leads,
        metrics: [
          { key: "recoveryOpportunities", value: candidates.length },
          { key: "highPriority", value: byPriority.high },
        ],
      });
    }

    case "recent_activity": {
      const activity = await getRecentActivity(organizationId, RECENT_ACTIVITY_LIMIT);
      const since = new Date(now.getTime() - 24 * 3_600_000).getTime();
      const today = activity.filter((a) => Date.parse(a.createdAt) >= since).length;
      return finalize({
        ...base,
        activity,
        metrics: [
          { key: "activityLast24h", value: today },
          { key: "activityShown", value: activity.length },
        ],
      });
    }

    case "pipeline_summary": {
      const [stats, insightSummary, followUpCounts, upcomingAppointments, recovery] =
        await Promise.all([
          getLeadStats(organizationId),
          getInsightSummary(organizationId),
          getFollowUpCounts(organizationId),
          getUpcomingAppointmentCount(organizationId),
          getRecoveryCandidates(organizationId, now),
        ]);
      return finalize({
        ...base,
        metrics: pipelineMetrics({
          stats,
          insightSummary,
          followUpCounts,
          upcomingAppointments,
          recoveryOpportunities: recovery.length,
        }),
      });
    }

    case "weekly_changes": {
      const [trends, activity] = await Promise.all([
        getDashboardTrends(organizationId, now),
        getRecentActivity(organizationId, RECENT_ACTIVITY_LIMIT),
      ]);
      const weekAgo = now.getTime() - 7 * 24 * 3_600_000;
      const thisWeek = activity.filter((a) => Date.parse(a.createdAt) >= weekAgo);
      return finalize({
        ...base,
        activity: thisWeek,
        metrics: weeklyChangeMetrics(trends),
      });
    }
  }
}

function finalize(r: Omit<IntentResult, "empty">): IntentResult {
  return { ...r, empty: isEmptyResult(r) };
}
