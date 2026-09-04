import { createClient } from "@/lib/supabase/server";
import { leadRowToRecord, type LeadRecord } from "@/lib/supabase/mappers";
import type { LeadListParams } from "@/lib/leads/list-params";
import type {
  LeadStatus,
  LeadTemperatureRow,
} from "@/lib/supabase/types";

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
}

export interface LeadListResult {
  rows: LeadListRow[];
  total: number;
  page: number;
  pageSize: number;
}

const LIST_COLUMNS =
  "id, name, phone, email, intent, score, temperature, status, source, created_at";

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

export async function listLeads(
  organizationId: string,
  params: LeadListParams,
): Promise<LeadListResult> {
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

  return {
    rows: (data ?? []).map((r) => toListRow(r as Parameters<typeof toListRow>[0])),
    total: count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
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

export interface LeadDetail {
  record: LeadRecord;
  conversations: LeadConversation[];
  messages: LeadMessage[];
  events: LeadEventRow[];
}

const MESSAGES_LIMIT = 300;
const EVENTS_LIMIT = 100;

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

  const [convResult, eventResult] = await Promise.all([
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
  ]);
  if (convResult.error) throw convResult.error;
  if (eventResult.error) throw eventResult.error;

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

  return {
    record: leadRowToRecord(leadRow),
    conversations,
    messages,
    events: (eventResult.data ?? []).map((e) => ({
      eventType: e.event_type,
      metadata: e.metadata,
      createdAt: e.created_at,
    })),
  };
}
