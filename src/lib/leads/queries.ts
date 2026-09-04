import { createClient } from "@/lib/supabase/server";
import { leadRowToRecord, dbTemperatureToApp, type LeadRecord } from "@/lib/supabase/mappers";
import type { LeadFocusValue, LeadListParams } from "@/lib/leads/list-params";
import {
  computeLeadInsight,
  type LeadInsight,
  type LeadInsightSignals,
  type RiskLevel,
} from "@/lib/leads/insights";
import type {
  FollowUpStatus,
  LeadStatus,
  LeadTemperatureRow,
} from "@/lib/supabase/types";

const CLOSED_LEAD_STATUSES = ["won", "lost", "archived"] as const;
const ACTIVE_APPOINTMENT_STATUSES = ["scheduled", "rescheduled"] as const;
/** Bounds for the insight candidate scan — an MVP-scale aggregate, not a full table scan. */
const INSIGHT_CANDIDATE_LEADS_LIMIT = 300;
const INSIGHT_RECENT_MESSAGES_LIMIT = 1500;
const INSIGHT_HANDOFF_EVENTS_LIMIT = 500;

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

  const [total, hot, warm, cold, qualified] = await Promise.all([
    base(),
    base().eq("temperature", "hot"),
    base().eq("temperature", "warm"),
    base().eq("temperature", "cold"),
    base().eq("status", "qualified"),
  ]);

  return {
    total: total.count ?? 0,
    hot: hot.count ?? 0,
    warm: warm.count ?? 0,
    cold: cold.count ?? 0,
    qualified: qualified.count ?? 0,
  };
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

/**
 * Shared by both the bounded candidate scan (dashboard summary + "focus"
 * filter) and single-page decoration (badges on an already-fetched, already
 * SQL-filtered/paginated page of leads) — one code path builds every
 * `LeadInsight`, just fed a different (and differently-sized) `leads` array.
 */
async function computeInsightsForLeads(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  leads: LeadListRow[],
  now: Date,
): Promise<InsightedLead[]> {
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

    return { lead, insight: computeLeadInsight(signals, now) };
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
  return computeInsightsForLeads(supabase, organizationId, leads, now);
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
