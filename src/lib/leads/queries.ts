import { createClient } from "@/lib/supabase/server";
import { leadRowToRecord, dbTemperatureToApp, type LeadRecord } from "@/lib/supabase/mappers";
import type { LeadFocusValue, LeadListParams } from "@/lib/leads/list-params";
import {
  computeLeadInsight,
  type LeadInsight,
  type LeadInsightSignals,
  type RiskLevel,
} from "@/lib/leads/insights";
import {
  computeRecoveryCandidate,
  computeRecoveryAttemptOutcome,
  resolveRecoveryChannel,
  type RecoveryAttemptSignals,
  type RecoveryCandidate,
  type RecoveryOutcome,
  type RecoveryPriority,
  type RecoveryResolvedAs,
  type RecoverySignals,
} from "@/lib/leads/recovery";
import type {
  FollowUpStatus,
  LeadStatus,
  LeadTemperatureRow,
} from "@/lib/supabase/types";

const CLOSED_LEAD_STATUSES = ["won", "lost", "archived"] as const;
const ACTIVE_APPOINTMENT_STATUSES = ["scheduled", "rescheduled"] as const;
/** Bounds for the insight candidate scan — an MVP-scale aggregate, not a full table scan. */
export const INSIGHT_CANDIDATE_LEADS_LIMIT = 300;
const INSIGHT_RECENT_MESSAGES_LIMIT = 1500;
const INSIGHT_HANDOFF_EVENTS_LIMIT = 500;
/** Revenue Recovery excludes only converted/archived leads — "lost" IS the primary target. */
const RECOVERY_EXCLUDED_STATUSES = ["won", "archived"] as const;
const RECOVERY_CANDIDATE_LEADS_LIMIT = 300;
const RECOVERY_ATTEMPTS_LIST_LIMIT = 200;

/**
 * All reads go through the request-scoped, RLS-enforced Supabase client. Every
 * query also carries an explicit `organization_id` filter (defence in depth) —
 * the id comes from the caller's membership, never from the client. The
 * service-role client is never used here.
 */

export interface LeadStats {
  total: number;
  hot: number;
  warm: number;
  cold: number;
  qualified: number;
  won: number;
  /** Leads created since the start of the current UTC day. */
  createdToday: number;
}

export interface LeadListRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  intent: string | null;
  score: number;
  temperature: LeadTemperatureRow;
  status: LeadStatus;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadListResult {
  rows: LeadListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Next Best Action insight per row (by lead id), for the list's badges. */
  insights: Map<string, LeadInsight>;
}

const LIST_COLUMNS =
  "id, name, phone, email, intent, score, temperature, status, source, created_at, updated_at";

function toListRow(row: {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  intent: string | null;
  score: number;
  temperature: LeadTemperatureRow;
  status: LeadStatus;
  source: string | null;
  created_at: string;
  updated_at: string;
}): LeadListRow {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    intent: row.intent,
    score: typeof row.score === "number" ? row.score : 0,
    temperature: row.temperature,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLeadStats(organizationId: string): Promise<LeadStats> {
  const supabase = await createClient();
  const base = () =>
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [total, hot, warm, cold, qualified, won, createdToday] = await Promise.all([
    base(),
    base().eq("temperature", "hot"),
    base().eq("temperature", "warm"),
    base().eq("temperature", "cold"),
    base().eq("status", "qualified"),
    base().eq("status", "won"),
    base().gte("created_at", startOfDay.toISOString()),
  ]);

  return {
    total: total.count ?? 0,
    hot: hot.count ?? 0,
    warm: warm.count ?? 0,
    cold: cold.count ?? 0,
    qualified: qualified.count ?? 0,
    won: won.count ?? 0,
    createdToday: createdToday.count ?? 0,
  };
}

/** Inclusive-from / exclusive-to bounds for a time-scoped count. Both optional. */
export interface DateWindow {
  from?: Date | null;
  to?: Date | null;
}

/**
 * Narrow a PostgREST query to a `created_at` window. The builder is chainable
 * but its self-type is awkward to name here, so this stays loosely typed —
 * every call site passes a real `leads` query builder.
 */
function applyWindow<T>(query: T, window: DateWindow | undefined, column = "created_at"): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  if (window?.from) q = q.gte(column, window.from.toISOString());
  if (window?.to) q = q.lt(column, window.to.toISOString());
  return q as T;
}

/**
 * Reusable, tenant-scoped lead filter set — the single place Ask LeadFlow's
 * `lead_search` / `lead_count` operations turn a validated plan into SQL. Every
 * value is already allowlisted / sanitised by `sales-manager/plan.ts`; `custom`
 * targets one `custom_data` key (regex-constrained to `[a-z0-9_]`).
 */
export interface LeadQueryFilters {
  status?: string[];
  temperature?: string[];
  source?: string[];
  createdFrom?: Date | null;
  createdTo?: Date | null;
  /** `updated_at` strictly before this — "has gone quiet for a while". */
  staleBefore?: Date | null;
  /** Free-text match on name / phone / email. */
  search?: string | null;
  /** One contains-match on an allowlisted industry field in `custom_data`. */
  custom?: { key: string; value: string } | null;
}

function applyLeadFilters<T>(query: T, f: LeadQueryFilters): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  if (f.status && f.status.length > 0) q = q.in("status", f.status);
  if (f.temperature && f.temperature.length > 0) q = q.in("temperature", f.temperature);
  if (f.source && f.source.length > 0) {
    q = q.or(f.source.map((s) => `source.ilike.${s.replace(/[%,()]/g, "")}`).join(","));
  }
  if (f.createdFrom) q = q.gte("created_at", f.createdFrom.toISOString());
  if (f.createdTo) q = q.lt("created_at", f.createdTo.toISOString());
  if (f.staleBefore) q = q.lt("updated_at", f.staleBefore.toISOString());
  if (f.search) {
    const p = f.search.replace(/[%,()]/g, "");
    q = q.or(`name.ilike.%${p}%,phone.ilike.%${p}%,email.ilike.%${p}%`);
  }
  if (f.custom) {
    const v = f.custom.value.replace(/[%,()]/g, "");
    q = q.ilike(`custom_data->>${f.custom.key}`, `%${v}%`);
  }
  return q as T;
}

/** Tenant-scoped head-count of leads matching {@link LeadQueryFilters}. */
export async function countLeadsFiltered(
  organizationId: string,
  filters: LeadQueryFilters = {},
): Promise<number> {
  const supabase = await createClient();
  const query = applyLeadFilters(
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    filters,
  );
  const { count } = await query;
  return count ?? 0;
}

export interface LeadSearchRow extends LeadListRow {
  customData: Record<string, unknown>;
}

export type LeadSearchSort =
  | "score_desc"
  | "created_desc"
  | "created_asc"
  | "updated_asc";

/**
 * Bounded, tenant-scoped list of leads matching {@link LeadQueryFilters}, with
 * `custom_data` included. `priority_desc` is NOT a SQL sort — the caller ranks
 * that in memory from computed insights; this returns rows in one of the
 * column sorts.
 */
export async function searchLeadsFiltered(
  organizationId: string,
  filters: LeadQueryFilters = {},
  opts: { sort?: LeadSearchSort; limit?: number } = {},
): Promise<LeadSearchRow[]> {
  const supabase = await createClient();
  const [col, asc] =
    opts.sort === "created_asc"
      ? (["created_at", true] as const)
      : opts.sort === "updated_asc"
        ? (["updated_at", true] as const)
        : opts.sort === "created_desc"
          ? (["created_at", false] as const)
          : (["score", false] as const);

  const query = applyLeadFilters(
    supabase
      .from("leads")
      .select(`${LIST_COLUMNS}, custom_data`)
      .eq("organization_id", organizationId)
      .order(col, { ascending: asc })
      .order("id", { ascending: false })
      .limit(Math.min(Math.max(opts.limit ?? 8, 1), 50)),
    filters,
  );
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => {
    const row = r as Parameters<typeof toListRow>[0] & {
      custom_data: Record<string, unknown> | null;
    };
    return { ...toListRow(row), customData: row.custom_data ?? {} };
  });
}

export interface LeadStatusCounts {
  total: number;
  byStatus: Record<string, number>;
}

/** Lead counts per pipeline status for the org, optionally time-scoped. */
export async function getLeadStatusCounts(
  organizationId: string,
  window: DateWindow = {},
): Promise<LeadStatusCounts> {
  const statuses = [
    "new",
    "contacted",
    "qualified",
    "appointment",
    "won",
    "lost",
    "archived",
  ] as const;
  const supabase = await createClient();
  const base = () => {
    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    q = applyWindow(q, window);
    return q;
  };
  const [total, ...perStatus] = await Promise.all([
    base(),
    ...statuses.map((s) => base().eq("status", s)),
  ]);
  const byStatus: Record<string, number> = {};
  statuses.forEach((s, i) => {
    byStatus[s] = perStatus[i].count ?? 0;
  });
  return { total: total.count ?? 0, byStatus };
}

export interface OpportunityCounts {
  total: number;
  hot: number;
  warm: number;
  cold: number;
}

/** Lead counts by opportunity level (temperature), optionally time-scoped. */
export async function getOpportunityCounts(
  organizationId: string,
  window: DateWindow = {},
): Promise<OpportunityCounts> {
  const supabase = await createClient();
  const base = () => {
    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    q = applyWindow(q, window);
    return q;
  };
  const [total, hot, warm, cold] = await Promise.all([
    base(),
    base().eq("temperature", "hot"),
    base().eq("temperature", "warm"),
    base().eq("temperature", "cold"),
  ]);
  return {
    total: total.count ?? 0,
    hot: hot.count ?? 0,
    warm: warm.count ?? 0,
    cold: cold.count ?? 0,
  };
}

/** Bound for the in-memory source tally — an MVP-scale aggregate, not a full scan. */
export const SOURCE_BREAKDOWN_LEADS_LIMIT = 2000;

export interface LeadSourceCounts {
  rows: { source: string | null; count: number }[];
  /** How many lead rows were scanned to build the tally. */
  scanned: number;
  /** True when the scan hit its bound — the breakdown may be incomplete. */
  capped: boolean;
}

/**
 * Lead counts grouped by `source`. PostgREST has no GROUP BY, so this reads the
 * `source` column for a bounded set of the org's most recent leads and tallies
 * in memory (same tradeoff as the insight candidate scan). `capped` tells the
 * caller the breakdown is a sample of the newest leads, not the whole org.
 */
export async function getLeadSourceCounts(
  organizationId: string,
  window: DateWindow = {},
): Promise<LeadSourceCounts> {
  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select("source")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(SOURCE_BREAKDOWN_LEADS_LIMIT);
  query = applyWindow(query, window);
  const { data, error } = await query;
  if (error) throw error;
  const scanned = (data ?? []).length;
  const tally = new Map<string, number>();
  for (const row of data ?? []) {
    const key = (row as { source: string | null }).source?.trim() || "";
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return {
    rows: [...tally.entries()].map(([source, count]) => ({
      source: source === "" ? null : source,
      count,
    })),
    scanned,
    capped: scanned >= SOURCE_BREAKDOWN_LEADS_LIMIT,
  };
}

/** Digits-only tail of a phone string, for a normalized exact-ish match. */
function phoneTail(raw: string): string {
  return raw.replace(/\D/g, "").slice(-12);
}

/**
 * Resolve a HUMAN reference (name / phone / email) to lead rows, tenant-scoped
 * and aggressively bounded. NOT a fuzzy database-wide search:
 *  - email → case-insensitive exact match
 *  - phone → normalized-tail match (handles +20 / 0 prefixes)
 *  - name  → contains-match on the sanitised value, newest first
 * Returns at most {@link cap} rows; the caller disambiguates / says "not found".
 */
export async function lookupLeadsByField(
  organizationId: string,
  by: "name" | "phone" | "email",
  value: string,
  cap = 6,
): Promise<LeadSearchRow[]> {
  const supabase = await createClient();
  const clean = value.trim();
  if (clean.length < 2) return [];

  let query = supabase
    .from("leads")
    .select(`${LIST_COLUMNS}, custom_data`)
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(cap);

  if (by === "email") {
    query = query.ilike("email", clean.replace(/[%,()*]/g, ""));
  } else if (by === "phone") {
    const tail = phoneTail(clean);
    if (tail.length < 3) return [];
    query = query.ilike("phone", `%${tail}`);
  } else {
    query = query.ilike("name", `%${clean.replace(/[%,()*]/g, "")}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => {
    const row = r as Parameters<typeof toListRow>[0] & {
      custom_data: Record<string, unknown> | null;
    };
    return { ...toListRow(row), customData: row.custom_data ?? {} };
  });
}

export interface ConversionStats {
  total: number;
  qualified: number;
  appointment: number;
  won: number;
  lost: number;
}

/** Win / loss / qualification counts for a conversion summary, optionally time-scoped. */
export async function getConversionStats(
  organizationId: string,
  window: DateWindow = {},
): Promise<ConversionStats> {
  const supabase = await createClient();
  const base = () => {
    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    q = applyWindow(q, window);
    return q;
  };
  const [total, qualified, appointment, won, lost] = await Promise.all([
    base(),
    base().eq("status", "qualified"),
    base().eq("status", "appointment"),
    base().eq("status", "won"),
    base().eq("status", "lost"),
  ]);
  return {
    total: total.count ?? 0,
    qualified: qualified.count ?? 0,
    appointment: appointment.count ?? 0,
    won: won.count ?? 0,
    lost: lost.count ?? 0,
  };
}

/**
 * Week/month period comparison for one metric — the `compare_periods`
 * operation. `new_leads` / `appointments` count rows in the two windows by
 * their own `created_at`; `qualified` / `won` count the `status_changed`
 * events into that status (so they measure what happened in the window, not
 * the current snapshot).
 */
export async function getMetricComparison(
  organizationId: string,
  metric: "new_leads" | "qualified" | "won" | "appointments",
  period: "week" | "month",
  now: Date = new Date(),
): Promise<{ current: number; previous: number }> {
  const supabase = await createClient();
  const span = (period === "week" ? 7 : 30) * 86_400_000;
  const nowIso = now.toISOString();
  const startCur = new Date(now.getTime() - span).toISOString();
  const startPrev = new Date(now.getTime() - 2 * span).toISOString();

  const countBetween = (
    table: "leads" | "appointments" | "lead_events",
    from: string,
    to: string,
    extra?: (q: unknown) => unknown,
  ) => {
    let q = supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", from)
      .lt("created_at", to);
    if (extra) q = extra(q) as typeof q;
    return q;
  };

  let curQ;
  let prevQ;
  if (metric === "new_leads") {
    curQ = countBetween("leads", startCur, nowIso);
    prevQ = countBetween("leads", startPrev, startCur);
  } else if (metric === "appointments") {
    curQ = countBetween("appointments", startCur, nowIso);
    prevQ = countBetween("appointments", startPrev, startCur);
  } else {
    const to = metric === "won" ? "won" : "qualified";
    const withStatus = (q: unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q as any).eq("event_type", "status_changed").eq("metadata->>to", to);
    curQ = countBetween("lead_events", startCur, nowIso, withStatus);
    prevQ = countBetween("lead_events", startPrev, startCur, withStatus);
  }

  const [cur, prev] = await Promise.all([curQ, prevQ]);
  return { current: cur.count ?? 0, previous: prev.count ?? 0 };
}

const FOCUS_TO_RISK_LEVEL: Record<LeadFocusValue, RiskLevel> = {
  needs_attention: "needs_attention",
  at_risk: "at_risk",
  no_action: "none",
};

/**
 * The "focus" (Next Best Action risk bucket) filter can't be expressed as a
 * `leads` column — it's computed. When present, filter/paginate the same
 * bounded candidate scan `getLeadInsightCandidates` already does for the
 * dashboard summary, in memory, instead of the normal SQL-filtered path.
 */
async function listLeadsByFocus(
  organizationId: string,
  params: LeadListParams,
): Promise<LeadListResult> {
  const candidates = await getLeadInsightCandidates(organizationId);
  const wantedRisk = FOCUS_TO_RISK_LEVEL[params.focus as LeadFocusValue];

  let filtered = candidates.filter((c) => c.insight.riskLevel === wantedRisk);

  if (params.temperature) {
    filtered = filtered.filter((c) => c.lead.temperature === params.temperature);
  }
  if (params.status) filtered = filtered.filter((c) => c.lead.status === params.status);
  if (params.searchPattern) {
    const needle = params.searchPattern.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        (c.lead.name ?? "").toLowerCase().includes(needle) ||
        (c.lead.phone ?? "").toLowerCase().includes(needle) ||
        (c.lead.email ?? "").toLowerCase().includes(needle),
    );
  }

  const page = filtered.slice(params.rangeFrom, params.rangeFrom + params.pageSize);

  return {
    rows: page.map((c) => c.lead),
    total: filtered.length,
    page: params.page,
    pageSize: params.pageSize,
    insights: new Map(page.map((c) => [c.lead.id, c.insight])),
  };
}

export async function listLeads(
  organizationId: string,
  params: LeadListParams,
): Promise<LeadListResult> {
  if (params.focus) return listLeadsByFocus(organizationId, params);

  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(params.rangeFrom, params.rangeTo);

  if (params.temperature) query = query.eq("temperature", params.temperature);
  if (params.status) query = query.eq("status", params.status);
  if (params.searchPattern) {
    const p = params.searchPattern; // already sanitised in list-params
    query = query.or(
      `name.ilike.%${p}%,phone.ilike.%${p}%,email.ilike.%${p}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = (data ?? []).map((r) => toListRow(r as Parameters<typeof toListRow>[0]));

  return {
    rows,
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
    insights: await attachInsights(organizationId, rows),
  };
}

export async function getRecentLeads(
  organizationId: string,
  limit = 6,
): Promise<LeadListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(LIST_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => toListRow(r as Parameters<typeof toListRow>[0]));
}

export interface LeadConversation {
  id: string;
  channel: string;
  status: string;
  startedAt: string;
  lastMessageAt: string;
}

export interface LeadMessage {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface LeadEventRow {
  eventType: string;
  metadata: unknown;
  createdAt: string;
}

export interface FollowUpRow {
  id: string;
  leadId: string;
  conversationId: string | null;
  scheduledAt: string;
  status: FollowUpStatus;
  note: string | null;
  source: string;
  channel: string;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentRow {
  id: string;
  leadId: string;
  conversationId: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  source: string;
  notes: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDetail {
  record: LeadRecord;
  conversations: LeadConversation[];
  messages: LeadMessage[];
  events: LeadEventRow[];
  followUps: FollowUpRow[];
  appointments: AppointmentRow[];
  /** True while a `human_handoff_requested` event exists for this lead. */
  needsAttention: boolean;
}

const FOLLOW_UP_COLUMNS =
  "id, lead_id, conversation_id, scheduled_at, status, note, source, channel, attempt_count, last_error, next_attempt_at, completed_at, created_at, updated_at";

function toFollowUpRow(r: {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  scheduled_at: string;
  status: FollowUpStatus;
  note: string | null;
  source: string;
  channel: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}): FollowUpRow {
  return {
    id: r.id,
    leadId: r.lead_id,
    conversationId: r.conversation_id,
    scheduledAt: r.scheduled_at,
    status: r.status,
    note: r.note,
    source: r.source,
    channel: r.channel,
    attemptCount: typeof r.attempt_count === "number" ? r.attempt_count : 0,
    lastError: r.last_error,
    nextAttemptAt: r.next_attempt_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const MESSAGES_LIMIT = 300;
const EVENTS_LIMIT = 100;

const APPOINTMENT_COLUMNS =
  "id, lead_id, conversation_id, starts_at, ends_at, timezone, status, source, notes, cancelled_reason, created_at, updated_at";

function toAppointmentRow(r: {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: string;
  source: string;
  notes: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
}): AppointmentRow {
  return {
    id: r.id,
    leadId: r.lead_id,
    conversationId: r.conversation_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    timezone: r.timezone,
    status: r.status,
    source: r.source,
    notes: r.notes,
    cancelledReason: r.cancelled_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getLeadDetail(
  organizationId: string,
  leadId: string,
): Promise<LeadDetail | null> {
  const supabase = await createClient();

  const { data: leadRow, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw leadError;
  if (!leadRow) return null;

  const [convResult, eventResult, followUpResult, appointmentResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, channel, status, started_at, last_message_at")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .order("started_at", { ascending: true }),
    supabase
      .from("lead_events")
      .select("event_type, metadata, created_at")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(EVENTS_LIMIT),
    supabase
      .from("lead_follow_ups")
      .select(FOLLOW_UP_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .order("scheduled_at", { ascending: true })
      .limit(50),
    supabase
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .order("starts_at", { ascending: true })
      .limit(50),
  ]);
  if (convResult.error) throw convResult.error;
  if (eventResult.error) throw eventResult.error;
  if (followUpResult.error) throw followUpResult.error;
  if (appointmentResult.error) throw appointmentResult.error;

  const events = (eventResult.data ?? []).map((e) => ({
    eventType: e.event_type,
    metadata: e.metadata,
    createdAt: e.created_at,
  }));

  const conversations: LeadConversation[] = (convResult.data ?? []).map((c) => ({
    id: c.id,
    channel: c.channel,
    status: c.status,
    startedAt: c.started_at,
    lastMessageAt: c.last_message_at,
  }));

  let messages: LeadMessage[] = [];
  if (conversations.length > 0) {
    const { data, error } = await supabase
      .from("messages")
      .select("conversation_id, role, content, created_at")
      .in(
        "conversation_id",
        conversations.map((c) => c.id),
      )
      .order("created_at", { ascending: true })
      .limit(MESSAGES_LIMIT);
    if (error) throw error;
    messages = (data ?? []).map((m) => ({
      conversationId: m.conversation_id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    }));
  }

  const followUps = (followUpResult.data ?? []).map((r) =>
    toFollowUpRow(r as Parameters<typeof toFollowUpRow>[0]),
  );
  const appointments = (appointmentResult.data ?? []).map((r) =>
    toAppointmentRow(r as Parameters<typeof toAppointmentRow>[0]),
  );

  return {
    record: leadRowToRecord(leadRow),
    conversations,
    messages,
    events,
    followUps,
    appointments,
    needsAttention: events.some(
      (e) => e.eventType === "human_handoff_requested",
    ),
  };
}

// ── Next Best Action / lost-lead candidates (dashboard summary + leads focus filter) ──

export interface InsightedLead {
  lead: LeadListRow;
  insight: LeadInsight;
}

/** Everything `computeInsightsForLeads` derives for one lead. */
interface LeadWithSignals {
  lead: LeadListRow;
  insight: LeadInsight;
  /** Exposed so `getRecoveryCandidates` can reuse this same fetch — see below. */
  signals: LeadInsightSignals;
}

/**
 * Shared by the bounded candidate scan (dashboard summary + "focus" filter),
 * single-page decoration (badges on an already-fetched, already SQL-filtered/
 * paginated page of leads), AND the Revenue Recovery candidate scan — one
 * code path fetches conversations/messages/follow-ups/appointments/handoff
 * events and builds every lead's signals once, just fed a different (and
 * differently-sized/filtered) `leads` array by each caller.
 */
async function computeInsightsForLeads(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  leads: LeadListRow[],
  now: Date,
): Promise<LeadWithSignals[]> {
  if (leads.length === 0) return [];
  const leadIds = leads.map((l) => l.id);

  const [convResult, followUpResult, appointmentResult, handoffResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, lead_id")
      .eq("organization_id", organizationId)
      .in("lead_id", leadIds),
    supabase
      .from("lead_follow_ups")
      .select("lead_id, scheduled_at, status")
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .in("lead_id", leadIds),
    supabase
      .from("appointments")
      .select("lead_id, starts_at, status, updated_at")
      .eq("organization_id", organizationId)
      .in("lead_id", leadIds),
    supabase
      .from("lead_events")
      .select("lead_id, created_at")
      .eq("organization_id", organizationId)
      .eq("event_type", "human_handoff_requested")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false })
      .limit(INSIGHT_HANDOFF_EVENTS_LIMIT),
  ]);
  if (convResult.error) throw convResult.error;
  if (followUpResult.error) throw followUpResult.error;
  if (appointmentResult.error) throw appointmentResult.error;
  if (handoffResult.error) throw handoffResult.error;

  const conversations = convResult.data ?? [];
  const conversationLead = new Map(conversations.map((c) => [c.id, c.lead_id]));

  // Most-recent-first messages for these conversations, bounded — only the
  // tail matters (the latest inbound/outbound per lead), not full history.
  const lastInboundByLead = new Map<string, string>();
  const lastOutboundByLead = new Map<string, string>();
  const lastMessageRoleByLead = new Map<string, string>();
  if (conversations.length > 0) {
    const { data: recentMessages, error: messagesError } = await supabase
      .from("messages")
      .select("conversation_id, role, created_at")
      .in(
        "conversation_id",
        conversations.map((c) => c.id),
      )
      .order("created_at", { ascending: false })
      .limit(INSIGHT_RECENT_MESSAGES_LIMIT);
    if (messagesError) throw messagesError;

    for (const m of recentMessages ?? []) {
      const leadId = conversationLead.get(m.conversation_id);
      if (!leadId) continue;
      if (!lastMessageRoleByLead.has(leadId)) lastMessageRoleByLead.set(leadId, m.role);
      if (m.role === "user" && !lastInboundByLead.has(leadId)) {
        lastInboundByLead.set(leadId, m.created_at);
      }
      if (m.role === "assistant" && !lastOutboundByLead.has(leadId)) {
        lastOutboundByLead.set(leadId, m.created_at);
      }
    }
  }

  const pendingFollowUpsByLead = new Map<string, { scheduledAt: string }[]>();
  for (const f of followUpResult.data ?? []) {
    const list = pendingFollowUpsByLead.get(f.lead_id) ?? [];
    list.push({ scheduledAt: f.scheduled_at });
    pendingFollowUpsByLead.set(f.lead_id, list);
  }

  const activeAppointmentByLead = new Map<string, { startsAt: string }>();
  const cancelledAppointmentsByLead = new Map<string, { updatedAt: string }[]>();
  for (const a of appointmentResult.data ?? []) {
    if ((ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(a.status)) {
      const existing = activeAppointmentByLead.get(a.lead_id);
      if (!existing || Date.parse(a.starts_at) < Date.parse(existing.startsAt)) {
        activeAppointmentByLead.set(a.lead_id, { startsAt: a.starts_at });
      }
    } else if (a.status === "cancelled") {
      const list = cancelledAppointmentsByLead.get(a.lead_id) ?? [];
      list.push({ updatedAt: a.updated_at });
      cancelledAppointmentsByLead.set(a.lead_id, list);
    }
  }

  const lastHandoffByLead = new Map<string, string>();
  for (const h of handoffResult.data ?? []) {
    if (!lastHandoffByLead.has(h.lead_id)) lastHandoffByLead.set(h.lead_id, h.created_at);
  }

  return leads.map((lead) => {
    const lastOutboundAt = lastOutboundByLead.get(lead.id) ?? null;
    const lastHandoffAt = lastHandoffByLead.get(lead.id) ?? null;
    const cancelledList = (cancelledAppointmentsByLead.get(lead.id) ?? []).sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );

    const signals: LeadInsightSignals = {
      status: lead.status,
      temperature: dbTemperatureToApp(lead.temperature),
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      lastInboundAt: lastInboundByLead.get(lead.id) ?? null,
      lastOutboundAt,
      lastMessageIsInbound: lastMessageRoleByLead.get(lead.id) === "user",
      handoffPending: lastHandoffAt !== null && (!lastOutboundAt || lastHandoffAt > lastOutboundAt),
      pendingFollowUps: pendingFollowUpsByLead.get(lead.id) ?? [],
      activeAppointment: activeAppointmentByLead.get(lead.id) ?? null,
      lastCancelledAppointment: cancelledList[0] ?? null,
    };

    return { lead, insight: computeLeadInsight(signals, now), signals };
  });
}

/**
 * Non-closed leads for the organization, each paired with its computed
 * insight. Bounded to `INSIGHT_CANDIDATE_LEADS_LIMIT` most-recently-updated
 * leads — an MVP-scale aggregate (same tradeoff as `getNeedsAttentionCount`'s
 * cap), not a full-table scan. Shared by the dashboard summary and the leads
 * list's "focus" filter so both use one code path.
 */
export async function getLeadInsightCandidates(
  organizationId: string,
  now: Date = new Date(),
): Promise<InsightedLead[]> {
  const supabase = await createClient();

  const { data: leadRows, error: leadsError } = await supabase
    .from("leads")
    .select(LIST_COLUMNS)
    .eq("organization_id", organizationId)
    .not("status", "in", `(${CLOSED_LEAD_STATUSES.join(",")})`)
    .order("updated_at", { ascending: false })
    .limit(INSIGHT_CANDIDATE_LEADS_LIMIT);
  if (leadsError) throw leadsError;

  const leads = (leadRows ?? []).map((r) => toListRow(r as Parameters<typeof toListRow>[0]));
  const withSignals = await computeInsightsForLeads(supabase, organizationId, leads, now);
  return withSignals.map(({ lead, insight }) => ({ lead, insight }));
}

/**
 * Decorates an already-fetched (SQL-filtered/paginated) page of leads with
 * their `LeadInsight`, for the per-row badge on the normal leads list. A
 * closed lead (won/lost/archived) always resolves to `none`/`none` via rule 0
 * — cheap and correct without a query — so only non-closed rows on the page
 * need the same signal-fetch `getLeadInsightCandidates` uses, scoped to just
 * this page's ids instead of the org-wide candidate bound.
 */
export async function attachInsights(
  organizationId: string,
  rows: LeadListRow[],
  now: Date = new Date(),
): Promise<Map<string, LeadInsight>> {
  const result = new Map<string, LeadInsight>();
  const open: LeadListRow[] = [];
  for (const row of rows) {
    if ((CLOSED_LEAD_STATUSES as readonly string[]).includes(row.status)) {
      result.set(row.id, computeLeadInsight(
        {
          status: row.status,
          temperature: dbTemperatureToApp(row.temperature),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          lastInboundAt: null,
          lastOutboundAt: null,
          lastMessageIsInbound: false,
          handoffPending: false,
          pendingFollowUps: [],
          activeAppointment: null,
          lastCancelledAppointment: null,
        },
        now,
      ));
    } else {
      open.push(row);
    }
  }
  if (open.length > 0) {
    const supabase = await createClient();
    for (const { lead, insight } of await computeInsightsForLeads(supabase, organizationId, open, now)) {
      result.set(lead.id, insight);
    }
  }
  return result;
}

export interface InsightSummary {
  needsAttention: number;
  atRisk: number;
  noActionNeeded: number;
}

/** Aggregate counts for the dashboard — see {@link getLeadInsightCandidates} for the scan bound. */
export async function getInsightSummary(organizationId: string): Promise<InsightSummary> {
  const candidates = await getLeadInsightCandidates(organizationId);
  const summary: InsightSummary = { needsAttention: 0, atRisk: 0, noActionNeeded: 0 };
  for (const { insight } of candidates) {
    if (insight.riskLevel === "needs_attention") summary.needsAttention++;
    else if (insight.riskLevel === "at_risk") summary.atRisk++;
    else summary.noActionNeeded++;
  }
  return summary;
}

// ── dashboard-overview aggregates ─────────────────────────────────────────

export interface FollowUpCounts {
  pending: number;
  dueNow: number;
  failed: number;
}

/** Follow-up workload counts for the dashboard overview. Org-scoped. */
export async function getFollowUpCounts(
  organizationId: string,
): Promise<FollowUpCounts> {
  const supabase = await createClient();
  const base = () =>
    supabase
      .from("lead_follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);

  const [pending, dueNow, failed] = await Promise.all([
    base().eq("status", "pending"),
    base().eq("status", "pending").lte("scheduled_at", new Date().toISOString()),
    base().eq("status", "failed"),
  ]);

  return {
    pending: pending.count ?? 0,
    dueNow: dueNow.count ?? 0,
    failed: failed.count ?? 0,
  };
}

export interface FollowUpListRow extends FollowUpRow {
  leadName: string | null;
  /** `pending` and past its scheduled time. */
  overdue: boolean;
}

/**
 * Pending + failed follow-ups, joined to their lead, soonest first — the
 * backing data for the `/dashboard/follow-ups` view. Bounded; a completed /
 * cancelled follow-up is history and is left out.
 */
export async function listOpenFollowUps(
  organizationId: string,
  limit = 100,
  now: Date = new Date(),
): Promise<FollowUpListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_follow_ups")
    .select(`${FOLLOW_UP_COLUMNS}, leads ( name )`)
    .eq("organization_id", organizationId)
    .in("status", ["pending", "failed"])
    .order("scheduled_at", { ascending: true })
    .limit(Math.min(limit, 200));
  if (error) throw error;
  const nowMs = now.getTime();
  return (data ?? []).map((r) => {
    const row = toFollowUpRow(r as Parameters<typeof toFollowUpRow>[0]);
    const lead = (r as { leads?: { name: string | null } | null }).leads;
    return {
      ...row,
      leadName: lead?.name ?? null,
      overdue: row.status === "pending" && Date.parse(row.scheduledAt) < nowMs,
    };
  });
}

export interface TrendValue {
  /** Count in the last 7 days. */
  current: number;
  /** Count in the 7 days before that. */
  previous: number;
}

export interface DashboardTrends {
  leads: TrendValue;
  qualified: TrendValue;
  appointments: TrendValue;
}

/**
 * Week-over-week counts for the KPI cards: the last 7 days vs the 7 days
 * before. Six bounded head-count queries. "Qualified" and "appointments" are
 * driven by their `lead_events` (`lead_qualified` / `appointment_booked`), so
 * they measure what happened in the window rather than the current snapshot.
 */
export async function getDashboardTrends(
  organizationId: string,
  now: Date = new Date(),
): Promise<DashboardTrends> {
  const supabase = await createClient();
  const day = 86_400_000;
  const start7 = new Date(now.getTime() - 7 * day).toISOString();
  const start14 = new Date(now.getTime() - 14 * day).toISOString();
  const nowIso = now.toISOString();

  const leadsBetween = (from: string, to: string) =>
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", from)
      .lt("created_at", to);
  const eventsBetween = (eventType: string, from: string, to: string) =>
    supabase
      .from("lead_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("event_type", eventType)
      .gte("created_at", from)
      .lt("created_at", to);

  const [lc, lp, qc, qp, ac, ap] = await Promise.all([
    leadsBetween(start7, nowIso),
    leadsBetween(start14, start7),
    eventsBetween("lead_qualified", start7, nowIso),
    eventsBetween("lead_qualified", start14, start7),
    eventsBetween("appointment_booked", start7, nowIso),
    eventsBetween("appointment_booked", start14, start7),
  ]);

  return {
    leads: { current: lc.count ?? 0, previous: lp.count ?? 0 },
    qualified: { current: qc.count ?? 0, previous: qp.count ?? 0 },
    appointments: { current: ac.count ?? 0, previous: ap.count ?? 0 },
  };
}

export interface UpcomingAppointmentRow extends AppointmentRow {
  leadName: string | null;
}

/** Soonest upcoming (active, not yet started) appointments for the dashboard overview. */
export async function getUpcomingAppointments(
  organizationId: string,
  limit = 6,
): Promise<UpcomingAppointmentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(`${APPOINTMENT_COLUMNS}, leads ( name )`)
    .eq("organization_id", organizationId)
    .in("status", ["scheduled", "rescheduled"])
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const row = toAppointmentRow(r as Parameters<typeof toAppointmentRow>[0]);
    const lead = (r as { leads?: { name: string | null } | null }).leads;
    return { ...row, leadName: lead?.name ?? null };
  });
}

/**
 * Appointments for the `/dashboard/appointments` view and Ask LeadFlow's
 * `appointment_search`. The `when` filter is pushed into SQL BEFORE the row
 * limit, so a "past" query is never crowded out by a wall of upcoming rows.
 */
export interface AppointmentListRow extends UpcomingAppointmentRow {
  /** Its scheduled start time is in the past. */
  past: boolean;
}

export type AppointmentWhen = "upcoming" | "past" | "all";

export interface AppointmentListOptions {
  /** Time window relative to `now`. Default `"all"`. */
  when?: AppointmentWhen;
  /** Restrict to these appointment statuses (empty / omitted → every status). */
  status?: string[];
  /** Row cap per window. Default 60. */
  limit?: number;
  now?: Date;
}

function appointmentQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  status: string[] | undefined,
) {
  let q = supabase
    .from("appointments")
    .select(`${APPOINTMENT_COLUMNS}, leads ( name )`)
    .eq("organization_id", organizationId);
  if (status && status.length > 0) q = q.in("status", status);
  return q;
}

export async function listAppointments(
  organizationId: string,
  opts: AppointmentListOptions = {},
): Promise<AppointmentListRow[]> {
  const when = opts.when ?? "all";
  const limit = opts.limit ?? 60;
  const now = opts.now ?? new Date();
  const supabase = await createClient();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const shape = (r: unknown): AppointmentListRow => {
    const row = toAppointmentRow(r as Parameters<typeof toAppointmentRow>[0]);
    const lead = (r as { leads?: { name: string | null } | null }).leads;
    return {
      ...row,
      leadName: lead?.name ?? null,
      past: Date.parse(row.startsAt) < nowMs,
    };
  };

  const upcomingQ = () =>
    appointmentQuery(supabase, organizationId, opts.status)
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(limit);
  const pastQ = () =>
    appointmentQuery(supabase, organizationId, opts.status)
      .lt("starts_at", nowIso)
      .order("starts_at", { ascending: false })
      .limit(limit);

  if (when === "upcoming") {
    const { data, error } = await upcomingQ();
    if (error) throw error;
    return (data ?? []).map(shape);
  }
  if (when === "past") {
    const { data, error } = await pastQ();
    if (error) throw error;
    return (data ?? []).map(shape);
  }
  // "all" — soonest upcoming first, then the most recent past ones.
  const [upcoming, past] = await Promise.all([upcomingQ(), pastQ()]);
  if (upcoming.error) throw upcoming.error;
  if (past.error) throw past.error;
  return [
    ...(upcoming.data ?? []).map(shape),
    ...(past.data ?? []).map(shape),
  ];
}

/**
 * Exact, tenant-scoped head-count of appointments in a time window — the
 * `count: "exact"` path, so a "how many past appointments" answer is never
 * distorted by a scan cap.
 */
export async function countAppointments(
  organizationId: string,
  opts: { when?: AppointmentWhen; status?: string[]; now?: Date } = {},
): Promise<number> {
  const supabase = await createClient();
  const nowIso = (opts.now ?? new Date()).toISOString();
  let q = supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (opts.status && opts.status.length > 0) q = q.in("status", opts.status);
  if (opts.when === "upcoming") q = q.gte("starts_at", nowIso);
  else if (opts.when === "past") q = q.lt("starts_at", nowIso);
  const { count } = await q;
  return count ?? 0;
}

/** How many active appointments are still upcoming — for the executive summary card. */
export async function getUpcomingAppointmentCount(
  organizationId: string,
): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["scheduled", "rescheduled"])
    .gt("starts_at", new Date().toISOString());
  return count ?? 0;
}

export interface ActivityEvent {
  id: string;
  leadId: string;
  leadName: string | null;
  eventType: string;
  metadata: unknown;
  createdAt: string;
}

export const ACTIVITY_FEED_LIMIT = 20;

/**
 * The organization's most recent `lead_events`, across every lead — the raw
 * material for the dashboard's Live Activity feed. Org-scoped (defence in
 * depth on top of RLS); the `leads` join is RLS-scoped too. Rendering
 * (localization) is done by `describeEventKey` + `resolveTimelineEntry`, the
 * same pipeline the per-lead timeline uses.
 */
export async function getRecentActivity(
  organizationId: string,
  limit = ACTIVITY_FEED_LIMIT,
): Promise<ActivityEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_events")
    .select("id, lead_id, event_type, metadata, created_at, leads ( name )")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, ACTIVITY_FEED_LIMIT));
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    leadName: (r as { leads?: { name: string | null } | null }).leads?.name ?? null,
    eventType: r.event_type,
    metadata: r.metadata,
    createdAt: r.created_at,
  }));
}

/** Distinct leads that have ever requested a human handoff. */
export async function getNeedsAttentionCount(
  organizationId: string,
): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lead_events")
    .select("lead_id")
    .eq("organization_id", organizationId)
    .eq("event_type", "human_handoff_requested")
    .limit(1000);
  return new Set((data ?? []).map((r) => r.lead_id)).size;
}

// ── Revenue Recovery (Phase L) ──────────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export interface RecoveryCandidateLead {
  lead: LeadListRow;
  candidate: RecoveryCandidate;
}

/**
 * Lost/inactive leads worth a recovery attempt, each paired with its
 * deterministic priority + reason. Bounded to `RECOVERY_CANDIDATE_LEADS_LIMIT`
 * least-recently-updated leads — an MVP-scale aggregate (same tradeoff as
 * `getLeadInsightCandidates`'s cap), not a full-table scan. Reuses the exact
 * same signal fetch as Next Best Action (`computeInsightsForLeads`) so
 * conversations/messages/follow-ups/appointments are scanned once, not twice.
 *
 * Unlike Next Best Action, "lost" is INCLUDED (it's the primary target) —
 * only "won" (converted) and "archived" leads are excluded.
 */
export async function getRecoveryCandidates(
  organizationId: string,
  now: Date = new Date(),
): Promise<RecoveryCandidateLead[]> {
  const supabase = await createClient();

  const { data: leadRows, error: leadsError } = await supabase
    .from("leads")
    .select(LIST_COLUMNS)
    .eq("organization_id", organizationId)
    .not("status", "in", `(${RECOVERY_EXCLUDED_STATUSES.join(",")})`)
    .order("updated_at", { ascending: true })
    .limit(RECOVERY_CANDIDATE_LEADS_LIMIT);
  if (leadsError) throw leadsError;

  const leads = (leadRows ?? []).map((r) => toListRow(r as Parameters<typeof toListRow>[0]));
  if (leads.length === 0) return [];
  const leadIds = leads.map((l) => l.id);

  const [withSignals, recoveryResult] = await Promise.all([
    computeInsightsForLeads(supabase, organizationId, leads, now),
    supabase
      .from("lead_recovery_attempts")
      .select("lead_id, resolved_at")
      .eq("organization_id", organizationId)
      .in("lead_id", leadIds),
  ]);
  if (recoveryResult.error) throw recoveryResult.error;

  const openRecoveryLeadIds = new Set<string>();
  const lastResolvedByLead = new Map<string, string>();
  for (const r of recoveryResult.data ?? []) {
    if (r.resolved_at === null) {
      openRecoveryLeadIds.add(r.lead_id);
    } else {
      const existing = lastResolvedByLead.get(r.lead_id);
      if (!existing || Date.parse(r.resolved_at) > Date.parse(existing)) {
        lastResolvedByLead.set(r.lead_id, r.resolved_at);
      }
    }
  }

  const candidates: RecoveryCandidateLead[] = [];
  for (const { lead, signals } of withSignals) {
    const recoverySignals: RecoverySignals = {
      status: signals.status,
      temperature: signals.temperature,
      createdAt: signals.createdAt,
      updatedAt: signals.updatedAt,
      lastInboundAt: signals.lastInboundAt,
      lastOutboundAt: signals.lastOutboundAt,
      hasPendingFollowUp: signals.pendingFollowUps.length > 0,
      hasActiveAppointment: signals.activeAppointment !== null,
      hasOpenRecoveryAttempt: openRecoveryLeadIds.has(lead.id),
      lastRecoveryResolvedAt: lastResolvedByLead.get(lead.id) ?? null,
    };
    const candidate = computeRecoveryCandidate(recoverySignals, now);
    if (candidate) candidates.push({ lead, candidate });
  }

  candidates.sort((a, b) => PRIORITY_RANK[a.candidate.priority] - PRIORITY_RANK[b.candidate.priority]);
  return candidates;
}

export interface RecoveryAttemptRow {
  id: string;
  leadId: string;
  leadName: string | null;
  followUpId: string;
  reasonKey: string;
  priority: RecoveryPriority;
  outcome: RecoveryOutcome;
  createdAt: string;
}

/**
 * Every recovery attempt for the org (most recent first), each with its
 * LIVE-derived outcome (see `computeRecoveryAttemptOutcome` — pending/
 * contacted/recovered are never stored, only computed). The one side effect:
 * an attempt that has just crossed into a terminal state (converted /
 * no_response / failed) gets that written back (`resolved_as`/`resolved_at`)
 * so the duplicate-attempt guard naturally frees up — best-effort, never
 * blocks the read.
 */
export async function listRecoveryAttempts(
  organizationId: string,
  now: Date = new Date(),
): Promise<RecoveryAttemptRow[]> {
  const supabase = await createClient();

  const { data: attemptRows, error } = await supabase
    .from("lead_recovery_attempts")
    .select(
      "id, lead_id, follow_up_id, reason_key, priority, resolved_as, resolved_at, created_at, leads ( name, status ), lead_follow_ups ( status, completed_at )",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(RECOVERY_ATTEMPTS_LIST_LIMIT);
  if (error) throw error;

  const rows = attemptRows ?? [];
  if (rows.length === 0) return [];
  const leadIds = [...new Set(rows.map((r) => r.lead_id))];

  const { data: conversations, error: convError } = await supabase
    .from("conversations")
    .select("id, lead_id")
    .eq("organization_id", organizationId)
    .in("lead_id", leadIds);
  if (convError) throw convError;

  const conversationLead = new Map((conversations ?? []).map((c) => [c.id, c.lead_id]));
  const lastInboundByLead = new Map<string, string>();
  if ((conversations ?? []).length > 0) {
    const { data: recentInbound, error: msgError } = await supabase
      .from("messages")
      .select("conversation_id, created_at")
      .eq("role", "user")
      .in(
        "conversation_id",
        (conversations ?? []).map((c) => c.id),
      )
      .order("created_at", { ascending: false })
      .limit(INSIGHT_RECENT_MESSAGES_LIMIT);
    if (msgError) throw msgError;
    for (const m of recentInbound ?? []) {
      const leadId = conversationLead.get(m.conversation_id);
      if (!leadId) continue;
      if (!lastInboundByLead.has(leadId)) lastInboundByLead.set(leadId, m.created_at);
    }
  }

  const toResolve: { id: string; resolvedAs: RecoveryResolvedAs }[] = [];
  const result: RecoveryAttemptRow[] = rows.map((r) => {
    const leadRel = (r as { leads?: { name: string | null; status: string } | null }).leads;
    const followUpRel = (r as { lead_follow_ups?: { status: string; completed_at: string | null } | null })
      .lead_follow_ups;

    const signals: RecoveryAttemptSignals = {
      leadStatus: leadRel?.status ?? "new",
      followUpStatus: followUpRel?.status ?? "pending",
      followUpCompletedAt: followUpRel?.completed_at ?? null,
      lastInboundAt: lastInboundByLead.get(r.lead_id) ?? null,
      resolvedAs: (r.resolved_as as RecoveryResolvedAs | null) ?? null,
    };
    const outcome = computeRecoveryAttemptOutcome(signals, now);
    if (!r.resolved_at && (outcome === "converted" || outcome === "no_response" || outcome === "failed")) {
      toResolve.push({ id: r.id, resolvedAs: outcome });
    }

    return {
      id: r.id,
      leadId: r.lead_id,
      leadName: leadRel?.name ?? null,
      followUpId: r.follow_up_id,
      reasonKey: r.reason_key,
      priority: r.priority as RecoveryPriority,
      outcome,
      createdAt: r.created_at,
    };
  });

  if (toResolve.length > 0) {
    const nowIso = now.toISOString();
    await Promise.all(
      toResolve.map(({ id, resolvedAs }) =>
        supabase
          .from("lead_recovery_attempts")
          .update({ resolved_as: resolvedAs, resolved_at: nowIso })
          .eq("organization_id", organizationId)
          .eq("id", id)
          .is("resolved_at", null)
          .then(({ error: resolveError }) => {
            if (resolveError) {
              console.error("recovery attempt resolve write-back failed:", resolveError.message);
            }
          }),
      ),
    );
  }

  return result;
}

export interface RecoverySummary {
  pending: number;
  contacted: number;
  recovered: number;
  converted: number;
  noResponse: number;
  /** Outreach that was never actually delivered (e.g. WhatsApp not connected) — distinct from noResponse. */
  failed: number;
}

/** Aggregate counts for the dashboard — see {@link listRecoveryAttempts} for the scan bound. */
export async function getRecoverySummary(organizationId: string): Promise<RecoverySummary> {
  const attempts = await listRecoveryAttempts(organizationId);
  const summary: RecoverySummary = {
    pending: 0,
    contacted: 0,
    recovered: 0,
    converted: 0,
    noResponse: 0,
    failed: 0,
  };
  for (const a of attempts) {
    if (a.outcome === "pending") summary.pending++;
    else if (a.outcome === "contacted") summary.contacted++;
    else if (a.outcome === "recovered") summary.recovered++;
    else if (a.outcome === "converted") summary.converted++;
    else if (a.outcome === "failed") summary.failed++;
    else summary.noResponse++;
  }
  return summary;
}

export interface StartRecoveryResult {
  status: "started" | "already_in_progress" | "not_eligible" | "failed";
  followUpId?: string;
  attemptId?: string;
}

/**
 * Deterministic, template-based outreach — no Claude call, matching
 * `follow-ups/message.ts`'s existing philosophy exactly. The `lead_follow_ups`
 * row this creates flows through the SAME scheduler/executor/channel
 * architecture as every other follow-up (Phase F/G/H) — nothing new to run it.
 */
const RECOVERY_MESSAGE =
  "We wanted to check back in — is this still something you're looking for? Happy to help whenever you're ready.";

/**
 * Starts a recovery attempt for one lead: re-validates eligibility
 * server-side (never trusts the candidate list the client was shown), then
 * creates a normal `lead_follow_ups` row (source='recovery') plus the
 * `lead_recovery_attempts` record that links to it. The DB's
 * `lead_recovery_attempts_open_per_lead` unique index is the hard duplicate
 * guard — a concurrent second call loses the race with a friendly outcome,
 * not a second attempt.
 */
export async function startRecoveryAttempt(
  organizationId: string,
  leadId: string,
  now: Date = new Date(),
): Promise<StartRecoveryResult> {
  const supabase = await createClient();

  const { data: leadRow, error: leadError } = await supabase
    .from("leads")
    .select(LIST_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) return { status: "failed" };
  if (!leadRow) return { status: "failed" };
  const lead = toListRow(leadRow as Parameters<typeof toListRow>[0]);

  const [withSignals, recoveryResult] = await Promise.all([
    computeInsightsForLeads(supabase, organizationId, [lead], now),
    supabase
      .from("lead_recovery_attempts")
      .select("resolved_at")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId),
  ]);
  if (recoveryResult.error) return { status: "failed" };
  const signals = withSignals[0]?.signals;
  if (!signals) return { status: "failed" };

  const rows = recoveryResult.data ?? [];
  const hasOpen = rows.some((r) => r.resolved_at === null);
  const lastResolvedAt =
    rows
      .map((r) => r.resolved_at)
      .filter((v): v is string => v !== null)
      .sort()
      .at(-1) ?? null;

  const recoverySignals: RecoverySignals = {
    status: signals.status,
    temperature: signals.temperature,
    createdAt: signals.createdAt,
    updatedAt: signals.updatedAt,
    lastInboundAt: signals.lastInboundAt,
    lastOutboundAt: signals.lastOutboundAt,
    hasPendingFollowUp: signals.pendingFollowUps.length > 0,
    hasActiveAppointment: signals.activeAppointment !== null,
    hasOpenRecoveryAttempt: hasOpen,
    lastRecoveryResolvedAt: lastResolvedAt,
  };

  const candidate = computeRecoveryCandidate(recoverySignals, now);
  if (!candidate) {
    return { status: hasOpen ? "already_in_progress" : "not_eligible" };
  }

  const channel = resolveRecoveryChannel({ phone: lead.phone });

  const { data: followUp, error: followUpError } = await supabase
    .from("lead_follow_ups")
    .insert({
      organization_id: organizationId,
      lead_id: leadId,
      conversation_id: null,
      scheduled_at: now.toISOString(),
      status: "pending",
      note: RECOVERY_MESSAGE,
      source: "recovery",
      channel,
    })
    .select("id")
    .single();
  if (followUpError || !followUp) return { status: "failed" };

  const { data: attempt, error: attemptError } = await supabase
    .from("lead_recovery_attempts")
    .insert({
      organization_id: organizationId,
      lead_id: leadId,
      follow_up_id: followUp.id,
      reason_key: candidate.reasonKey,
      priority: candidate.priority,
    })
    .select("id")
    .single();
  if (attemptError || !attempt) {
    // 23505 = the unique-open-per-lead index — lost a genuine race against
    // another attempt started concurrently. The follow-up row above is a
    // rare, harmless leftover (one extra outreach message), not a
    // data-integrity issue.
    if ((attemptError as { code?: string } | null)?.code === "23505") {
      return { status: "already_in_progress", followUpId: followUp.id };
    }
    return { status: "failed", followUpId: followUp.id };
  }

  await supabase.from("lead_events").insert({
    organization_id: organizationId,
    lead_id: leadId,
    event_type: "recovery_attempt_started",
    metadata: {
      followUpId: followUp.id,
      attemptId: attempt.id,
      reasonKey: candidate.reasonKey,
      priority: candidate.priority,
    },
  });

  return { status: "started", followUpId: followUp.id, attemptId: attempt.id };
}
