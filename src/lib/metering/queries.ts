/**
 * Dashboard read layer for usage & cost metering. Every read runs on the
 * caller's RLS-scoped session client and is additionally scoped by the
 * membership-derived `organization_id`. The `ai_usage_events` /
 * `organization_usage_limits` RLS policies restrict SELECT to owner/admin, so a
 * viewer / manager / sales session gets nothing here even if it reaches this
 * code.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { aggregateUsage, type UsageAggregate, type UsageEvent } from "./aggregate.ts";
import {
  currentMonthRange,
  previousMonthRange,
} from "./period.ts";
import {
  evaluateUsageLimits,
  NO_LIMITS,
  type LimitEvaluation,
  type UsageLimits,
} from "./limits.ts";

type Db = SupabaseClient<Database>;

/** Safety cap on rows scanned for the dashboard (≈ a very busy pilot month). */
const MAX_ROWS = 100_000;

const EVENT_COLUMNS =
  "request_type, model, channel, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, estimated_cost_usd, conversation_id, lead_id, occurred_at";

interface EventRow {
  request_type: string;
  model: string;
  channel: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  estimated_cost_usd: number | string;
  conversation_id: string | null;
  lead_id: string | null;
  occurred_at: string;
}

function toEvent(row: EventRow): UsageEvent {
  return {
    requestType: row.request_type,
    model: row.model,
    channel: row.channel,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    cacheReadInputTokens: row.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: row.cache_creation_input_tokens ?? 0,
    // `numeric` comes back as a string from PostgREST.
    estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
    conversationId: row.conversation_id,
    leadId: row.lead_id,
    occurredAt: row.occurred_at,
  };
}

async function fetchEvents(
  db: Db,
  organizationId: string,
  startIso: string,
  endIso: string,
): Promise<UsageEvent[]> {
  const { data, error } = await db
    .from("ai_usage_events")
    .select(EVENT_COLUMNS)
    .eq("organization_id", organizationId)
    .gte("occurred_at", startIso)
    .lt("occurred_at", endIso)
    .order("occurred_at", { ascending: true })
    .limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []).map((r) => toEvent(r as EventRow));
}

export async function getUsageLimits(
  db: Db,
  organizationId: string,
): Promise<UsageLimits | null> {
  const { data, error } = await db
    .from("organization_usage_limits")
    .select(
      "monthly_token_limit, monthly_request_limit, monthly_cost_limit_usd, warning_threshold_percent, hard_limit_enabled",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    monthlyTokenLimit: data.monthly_token_limit,
    monthlyRequestLimit: data.monthly_request_limit,
    monthlyCostLimitUsd: data.monthly_cost_limit_usd,
    warningThresholdPercent: data.warning_threshold_percent,
    hardLimitEnabled: data.hard_limit_enabled,
  };
}

export interface UsageDashboardData {
  aggregate: UsageAggregate;
  /** `null` when the org has never configured limits. */
  limits: UsageLimits | null;
  /** Evaluation of the current-month totals against `limits` (or `NO_LIMITS`). */
  evaluation: LimitEvaluation;
}

/**
 * Everything the Usage settings page renders. One call, two bounded range
 * queries + the limits row.
 */
export async function getUsageDashboardData(
  db: Db,
  organizationId: string,
  now: Date = new Date(),
): Promise<UsageDashboardData> {
  const current = currentMonthRange(now);
  const previous = previousMonthRange(now);

  const [currentEvents, previousEvents, limits] = await Promise.all([
    fetchEvents(db, organizationId, current.startIso, current.endIso),
    fetchEvents(db, organizationId, previous.startIso, previous.endIso),
    getUsageLimits(db, organizationId),
  ]);

  const aggregate = aggregateUsage(currentEvents, previousEvents, now);
  const evaluation = evaluateUsageLimits(
    {
      totalTokens: aggregate.currentMonth.totalTokens,
      totalRequests: aggregate.currentMonth.totalRequests,
      totalCostUsd: aggregate.currentMonth.totalCostUsd,
    },
    limits ?? NO_LIMITS,
  );

  return { aggregate, limits, evaluation };
}
