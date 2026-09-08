/**
 * Ask LeadFlow — deterministic ranking, filtering and shaping.
 *
 * Pure and import-light (structural input types, like `insights.ts`), so it
 * runs under `node --test` and is the place every "which leads / how many /
 * what changed" answer is actually computed. The model only ever *phrases* the
 * `IntentResult` this produces — it never ranks or counts.
 */

import type { AskIntent } from "./intents.ts";

/** Max lead / appointment cards returned for any one answer — keeps context bounded. */
export const CARD_LIMIT = 8;

// ── input shapes (structurally compatible with queries.ts / insights.ts) ──────

export interface CandidateLeadLike {
  id: string;
  name: string | null;
  status: string;
  /** Row form: "hot" | "warm" | "cold". */
  temperature: string;
  score: number;
  updatedAt: string;
}

export interface CandidateInsightLike {
  riskLevel: "needs_attention" | "at_risk" | "none";
  action: string;
  reasonKey: string;
  reasonParams?: Record<string, string | number>;
}

export interface InsightCandidate {
  lead: CandidateLeadLike;
  insight: CandidateInsightLike;
}

export interface RecoveryCandidateLike {
  lead: CandidateLeadLike;
  candidate: {
    priority: "high" | "medium" | "low";
    reasonKey: string;
    reasonParams?: Record<string, string | number>;
  };
}

export interface AppointmentLike {
  id: string;
  leadId: string;
  leadName: string | null;
  startsAt: string;
  status: string;
}

export interface FollowUpLike {
  id: string;
  leadId: string;
  leadName: string | null;
  scheduledAt: string;
  status: string;
  overdue: boolean;
}

export interface ActivityLike {
  id: string;
  leadId: string;
  leadName: string | null;
  eventType: string;
  metadata: unknown;
  createdAt: string;
}

export interface PipelineInput {
  stats: {
    total: number;
    hot: number;
    warm: number;
    cold: number;
    qualified: number;
    won: number;
    createdToday: number;
  };
  insightSummary: { needsAttention: number; atRisk: number; noActionNeeded: number };
  followUpCounts: { pending: number; dueNow: number; failed: number };
  upcomingAppointments: number;
  recoveryOpportunities: number;
}

export interface WeeklyChangeInput {
  leads: { current: number; previous: number };
  qualified: { current: number; previous: number };
  appointments: { current: number; previous: number };
}

// ── output shapes ────────────────────────────────────────────────────────────

export interface MetricValue {
  /** Dotted key under `askLeadFlow.metrics.*`. */
  key: string;
  value: number | string;
  /** Signed delta for a week-over-week metric. */
  delta?: number;
}

export interface LeadCard {
  id: string;
  name: string | null;
  status: string;
  temperature: string;
  score: number;
  /** Dotted i18n key for the reason line, or null. */
  reasonKey: string | null;
  reasonParams?: Record<string, string | number>;
  /** Canonical Next-Best-Action ("call_now", …) or recovery priority ("high"), for a badge. */
  tag: string | null;
  href: string;
}

export interface AppointmentCard {
  id: string;
  leadId: string;
  leadName: string | null;
  startsAt: string;
  status: string;
  href: string;
}

export interface IntentResult {
  intent: AskIntent;
  metrics: MetricValue[];
  leads: LeadCard[];
  appointments: AppointmentCard[];
  activity: ActivityLike[];
  /** Nothing to report → the answer is a deterministic "no data" line, no AI call. */
  empty: boolean;
}

const leadHref = (id: string) => `/dashboard/leads/${id}`;

function toLeadCard(
  lead: CandidateLeadLike,
  reasonKey: string | null,
  reasonParams: Record<string, string | number> | undefined,
  tag: string | null,
): LeadCard {
  return {
    id: lead.id,
    name: lead.name,
    status: lead.status,
    temperature: lead.temperature,
    score: typeof lead.score === "number" ? lead.score : 0,
    reasonKey,
    reasonParams,
    tag,
    href: leadHref(lead.id),
  };
}

const RISK_RANK: Record<string, number> = { needs_attention: 0, at_risk: 1, none: 2 };
const RECOVERY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function byNeglect(a: CandidateLeadLike, b: CandidateLeadLike): number {
  // Higher score first, then the lead untouched longest.
  if (b.score !== a.score) return b.score - a.score;
  return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
}

/** "Who should we work first" — needs-attention, then at-risk, then by score/neglect. */
export function rankPriorityLeads(
  candidates: InsightCandidate[],
  limit = CARD_LIMIT,
): LeadCard[] {
  return [...candidates]
    .filter((c) => c.insight.riskLevel !== "none")
    .sort((a, b) => {
      const r = RISK_RANK[a.insight.riskLevel] - RISK_RANK[b.insight.riskLevel];
      return r !== 0 ? r : byNeglect(a.lead, b.lead);
    })
    .slice(0, limit)
    .map((c) => toLeadCard(c.lead, c.insight.reasonKey, c.insight.reasonParams, c.insight.action));
}

/** Leads in a single risk band. */
export function filterByRisk(
  candidates: InsightCandidate[],
  risk: "needs_attention" | "at_risk",
  limit = CARD_LIMIT,
): LeadCard[] {
  return [...candidates]
    .filter((c) => c.insight.riskLevel === risk)
    .sort((a, b) => byNeglect(a.lead, b.lead))
    .slice(0, limit)
    .map((c) => toLeadCard(c.lead, c.insight.reasonKey, c.insight.reasonParams, c.insight.action));
}

export function rankRecovery(
  candidates: RecoveryCandidateLike[],
  limit = CARD_LIMIT,
): LeadCard[] {
  return [...candidates]
    .sort((a, b) => {
      const r = RECOVERY_RANK[a.candidate.priority] - RECOVERY_RANK[b.candidate.priority];
      return r !== 0 ? r : byNeglect(a.lead, b.lead);
    })
    .slice(0, limit)
    .map((c) =>
      toLeadCard(c.lead, c.candidate.reasonKey, c.candidate.reasonParams, c.candidate.priority),
    );
}

/** Soonest-first upcoming appointments. */
export function shapeAppointments(
  appts: AppointmentLike[],
  limit = CARD_LIMIT,
): AppointmentCard[] {
  return [...appts]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, limit)
    .map((a) => ({
      id: a.id,
      leadId: a.leadId,
      leadName: a.leadName,
      startsAt: a.startsAt,
      status: a.status,
      href: leadHref(a.leadId),
    }));
}

/** Overdue (pending + past-due) then failed follow-ups, soonest-scheduled first. */
export function shapeOverdueFollowUps(
  followUps: FollowUpLike[],
  limit = CARD_LIMIT,
): { cards: LeadCard[]; overdueCount: number; failedCount: number } {
  const overdue = followUps.filter((f) => f.overdue);
  const failed = followUps.filter((f) => f.status === "failed");
  const ordered = [...overdue, ...failed].sort(
    (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
  );
  const cards = ordered.slice(0, limit).map((f) =>
    toLeadCard(
      {
        id: f.leadId,
        name: f.leadName,
        status: "",
        temperature: "",
        score: 0,
        updatedAt: f.scheduledAt,
      },
      f.overdue ? "askLeadFlow.reasons.followUpOverdue" : "askLeadFlow.reasons.followUpFailed",
      undefined,
      f.overdue ? "follow_up" : "failed",
    ),
  );
  return { cards, overdueCount: overdue.length, failedCount: failed.length };
}

export function pipelineMetrics(input: PipelineInput): MetricValue[] {
  return [
    { key: "totalLeads", value: input.stats.total },
    { key: "newToday", value: input.stats.createdToday },
    { key: "hot", value: input.stats.hot },
    { key: "qualified", value: input.stats.qualified },
    { key: "won", value: input.stats.won },
    { key: "needsAttention", value: input.insightSummary.needsAttention },
    { key: "atRisk", value: input.insightSummary.atRisk },
    { key: "followUpsDue", value: input.followUpCounts.dueNow },
    { key: "upcomingAppointments", value: input.upcomingAppointments },
    { key: "recoveryOpportunities", value: input.recoveryOpportunities },
  ];
}

export function weeklyChangeMetrics(input: WeeklyChangeInput): MetricValue[] {
  const row = (key: string, v: { current: number; previous: number }): MetricValue => ({
    key,
    value: v.current,
    delta: v.current - v.previous,
  });
  return [
    row("newLeads", input.leads),
    row("qualified", input.qualified),
    row("appointmentsBooked", input.appointments),
  ];
}

/** Whether the shaped result has anything worth an AI answer. */
export function isEmptyResult(r: Omit<IntentResult, "empty">): boolean {
  if (r.leads.length > 0 || r.appointments.length > 0 || r.activity.length > 0) return false;
  // A pipeline/weekly summary with all-zero numbers still counts as "no data".
  return r.metrics.every((m) => {
    const n = typeof m.value === "number" ? m.value : Number(m.value);
    return !Number.isFinite(n) || n === 0;
  });
}
