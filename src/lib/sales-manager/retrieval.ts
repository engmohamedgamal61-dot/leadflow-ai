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
  getDashboardTrends,
  getFollowUpCounts,
  getInsightSummary,
  getLeadInsightCandidates,
  getLeadStats,
  getRecentActivity,
  getRecoveryCandidates,
  getUpcomingAppointmentCount,
  getUpcomingAppointments,
  listOpenFollowUps,
} from "@/lib/leads/queries";
import type { AskIntent } from "./intents.ts";
import {
  filterByRisk,
  isEmptyResult,
  pipelineMetrics,
  rankPriorityLeads,
  rankRecovery,
  shapeAppointments,
  shapeOverdueFollowUps,
  weeklyChangeMetrics,
  type IntentResult,
} from "./ranking.ts";

const RECENT_ACTIVITY_LIMIT = 12;

/** Run one allowlisted intent for an organization. Bounded reads only. */
export async function runIntent(
  intent: AskIntent,
  organizationId: string,
  now: Date = new Date(),
): Promise<IntentResult> {
  const base = {
    intent,
    metrics: [] as IntentResult["metrics"],
    leads: [] as IntentResult["leads"],
    appointments: [] as IntentResult["appointments"],
    activity: [] as IntentResult["activity"],
  };

  switch (intent) {
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
