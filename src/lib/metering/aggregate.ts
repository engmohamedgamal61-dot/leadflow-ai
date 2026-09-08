/**
 * Usage aggregation for the dashboard. Pure — deterministic for a given set of
 * rows + `now`. No I/O: the read layer (`queries.ts`) fetches the month's
 * RLS-scoped rows and hands them here.
 *
 * Provides, per organization: today / current-month / previous-month totals,
 * estimated AI cost, average cost per conversation and per lead, a breakdown by
 * model and by request type, and a zero-filled daily trend for the current
 * month.
 */

import {
  billingDateKey,
  currentMonthRange,
  dateKeysInRange,
  previousMonthRange,
  todayRange,
  type InstantRange,
} from "./period.ts";
import { asAiRequestType } from "./types.ts";

export interface UsageEvent {
  requestType: string;
  model: string;
  channel: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  estimatedCostUsd: number;
  conversationId: string | null;
  leadId: string | null;
  occurredAt: string;
}

export interface PeriodTotals {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalRequests: number;
  totalCostUsd: number;
  distinctConversations: number;
  distinctLeads: number;
  /** `totalCostUsd / distinctConversations`, or 0 when there are none. */
  avgCostPerConversation: number;
  avgCostPerLead: number;
}

export interface ModelUsage {
  model: string;
  requests: number;
  totalTokens: number;
  costUsd: number;
}

export interface RequestTypeUsage {
  /** Canonical request type, or `"other"` for an unrecognised stored value. */
  requestType: string;
  requests: number;
  totalTokens: number;
  costUsd: number;
}

export interface DailyUsagePoint {
  /** `YYYY-MM-DD` in the billing timezone. */
  date: string;
  requests: number;
  totalTokens: number;
  costUsd: number;
}

export interface UsageAggregate {
  today: PeriodTotals;
  currentMonth: PeriodTotals;
  previousMonth: PeriodTotals;
  /** Current-month breakdown, descending by cost. */
  byModel: ModelUsage[];
  byRequestType: RequestTypeUsage[];
  /** Current-month daily trend, one entry per calendar day (zero-filled). */
  daily: DailyUsagePoint[];
}

const eventTokens = (e: UsageEvent): number =>
  (e.inputTokens || 0) +
  (e.outputTokens || 0) +
  (e.cacheReadInputTokens || 0) +
  (e.cacheCreationInputTokens || 0);

function inRange(iso: string, range: InstantRange): boolean {
  const t = Date.parse(iso);
  return (
    !Number.isNaN(t) &&
    t >= Date.parse(range.startIso) &&
    t < Date.parse(range.endIso)
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function periodTotals(events: UsageEvent[]): PeriodTotals {
  const conversations = new Set<string>();
  const leads = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let totalCostUsd = 0;

  for (const e of events) {
    inputTokens += e.inputTokens || 0;
    outputTokens += e.outputTokens || 0;
    cacheReadTokens += e.cacheReadInputTokens || 0;
    cacheCreationTokens += e.cacheCreationInputTokens || 0;
    totalCostUsd += e.estimatedCostUsd || 0;
    if (e.conversationId) conversations.add(e.conversationId);
    if (e.leadId) leads.add(e.leadId);
  }

  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  const cost = round6(totalCostUsd);
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalRequests: events.length,
    totalCostUsd: cost,
    distinctConversations: conversations.size,
    distinctLeads: leads.size,
    avgCostPerConversation: conversations.size ? round6(cost / conversations.size) : 0,
    avgCostPerLead: leads.size ? round6(cost / leads.size) : 0,
  };
}

function byModel(events: UsageEvent[]): ModelUsage[] {
  const map = new Map<string, ModelUsage>();
  for (const e of events) {
    const row = map.get(e.model) ?? { model: e.model, requests: 0, totalTokens: 0, costUsd: 0 };
    row.requests += 1;
    row.totalTokens += eventTokens(e);
    row.costUsd += e.estimatedCostUsd || 0;
    map.set(e.model, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, costUsd: round6(r.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);
}

function byRequestType(events: UsageEvent[]): RequestTypeUsage[] {
  const map = new Map<string, RequestTypeUsage>();
  for (const e of events) {
    const key = asAiRequestType(e.requestType) ?? "other";
    const row = map.get(key) ?? { requestType: key, requests: 0, totalTokens: 0, costUsd: 0 };
    row.requests += 1;
    row.totalTokens += eventTokens(e);
    row.costUsd += e.estimatedCostUsd || 0;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, costUsd: round6(r.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

function dailyTrend(events: UsageEvent[], range: InstantRange): DailyUsagePoint[] {
  const buckets = new Map<string, DailyUsagePoint>();
  for (const key of dateKeysInRange(range)) {
    buckets.set(key, { date: key, requests: 0, totalTokens: 0, costUsd: 0 });
  }
  for (const e of events) {
    const key = billingDateKey(e.occurredAt);
    const point = buckets.get(key);
    if (!point) continue;
    point.requests += 1;
    point.totalTokens += eventTokens(e);
    point.costUsd += e.estimatedCostUsd || 0;
  }
  return [...buckets.values()]
    .map((p) => ({ ...p, costUsd: round6(p.costUsd) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Build the full dashboard aggregate.
 *
 * @param currentMonthEvents rows with `occurred_at` inside the current billing month
 * @param previousMonthEvents rows inside the previous billing month
 */
export function aggregateUsage(
  currentMonthEvents: UsageEvent[],
  previousMonthEvents: UsageEvent[],
  now: Date = new Date(),
): UsageAggregate {
  const monthRange = currentMonthRange(now);
  const todaysRange = todayRange(now);

  const todayEvents = currentMonthEvents.filter((e) => inRange(e.occurredAt, todaysRange));

  return {
    today: periodTotals(todayEvents),
    currentMonth: periodTotals(currentMonthEvents),
    previousMonth: periodTotals(previousMonthEvents),
    byModel: byModel(currentMonthEvents),
    byRequestType: byRequestType(currentMonthEvents),
    daily: dailyTrend(currentMonthEvents, monthRange),
  };
}

export { currentMonthRange, previousMonthRange, round2, round6 };
