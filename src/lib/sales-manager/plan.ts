/**
 * Ask LeadFlow — the bounded data-query PLAN format + its trust boundary.
 *
 * Pure, dependency-light, deterministic. The AI planner (`answer.ts`
 * `planQuestion`) turns a free-text business question into a small JSON plan
 * that combines one or more ALLOWLISTED data operations. This module is the
 * validator: it treats the planner output as untrusted and rejects anything
 * outside the allowlists.
 *
 * The model may interpret language freely, but it can never:
 *   - name an operation that isn't in {@link OPERATION_TYPES}
 *   - name a filter that isn't in the per-operation field allowlist
 *   - pass an unknown enum value, sort, group-by, period or time range
 *   - exceed the per-operation result cap or the per-request operation cap
 *   - reference a table, a column, an operator, or another tenant's id
 *
 * An invalid or unsafe plan is NOT coerced into a "best guess" — the caller
 * asks the user to rephrase (or, for a rejected offline fallback, refuses).
 */

import {
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  type LeadStatusValue,
  type LeadTemperatureValue,
} from "../leads/list-params.ts";
import type { AskIntent } from "./intents.ts";

// ── time ranges (shared by the planner + every time-scoped operation) ─────────

export const TIME_RANGE_KEYS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "all_time",
] as const;
export type TimeRangeKey = (typeof TIME_RANGE_KEYS)[number];

export interface ResolvedRange {
  /** Inclusive lower bound, or null for "no lower bound". */
  from: Date | null;
  /** Exclusive upper bound, or null for "up to now". */
  to: Date | null;
}

const DAY_MS = 86_400_000;

function startOfUtcDay(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Concrete UTC bounds for a {@link TimeRangeKey}. Windows are rolling and
 * consistent with the dashboard trend queries (last-7 vs previous-7).
 */
export function resolveTimeRange(
  key: TimeRangeKey,
  now: Date = new Date(),
): ResolvedRange {
  switch (key) {
    case "today":
      return { from: startOfUtcDay(now), to: null };
    case "yesterday": {
      const start = startOfUtcDay(now);
      return { from: new Date(start.getTime() - DAY_MS), to: start };
    }
    case "this_week":
    case "last_7_days":
      return { from: new Date(now.getTime() - 7 * DAY_MS), to: null };
    case "last_week":
      return {
        from: new Date(now.getTime() - 14 * DAY_MS),
        to: new Date(now.getTime() - 7 * DAY_MS),
      };
    case "this_month":
    case "last_30_days":
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: null };
    case "last_month":
      return {
        from: new Date(now.getTime() - 60 * DAY_MS),
        to: new Date(now.getTime() - 30 * DAY_MS),
      };
    case "all_time":
    default:
      return { from: null, to: null };
  }
}

// ── allowlists ───────────────────────────────────────────────────────────────

export const OPERATION_TYPES = [
  "lead_search",
  "lead_count",
  "lead_count_grouped",
  "pipeline_metrics",
  "compare_periods",
  "appointment_search",
  "appointment_count",
  "followup_search",
  "lead_details",
  "conversion_summary",
  "activity_search",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const LEAD_SORTS = [
  "priority_desc",
  "score_desc",
  "created_desc",
  "created_asc",
  "updated_asc",
] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export const LEAD_GROUP_BY = ["status", "opportunity", "source"] as const;
export type LeadGroupBy = (typeof LEAD_GROUP_BY)[number];

export const COMPARE_METRICS = [
  "new_leads",
  "qualified",
  "won",
  "appointments",
] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

export const COMPARE_PERIODS = ["week", "month"] as const;
export type ComparePeriod = (typeof COMPARE_PERIODS)[number];

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "rescheduled",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type AppointmentStatusValue = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_WHEN = ["upcoming", "past", "all"] as const;
export type AppointmentWhen = (typeof APPOINTMENT_WHEN)[number];

export const FOLLOWUP_STATES = ["open", "overdue", "failed", "pending"] as const;
export type FollowupState = (typeof FOLLOWUP_STATES)[number];

/** Per-request cap on how many operations one plan may combine. */
export const MAX_OPERATIONS = 5;

/** Per-operation result-row caps (also re-enforced in the execution layer). */
export const LIMITS = {
  lead_search: { max: 25, default: 8 },
  appointment_search: { max: 25, default: 8 },
  followup_search: { max: 25, default: 8 },
  activity_search: { max: 20, default: 12 },
} as const;

/**
 * Schema handed to Anthropic `output_config` so the planner returns an object
 * with an `operations` array. Kept deliberately loose (no nested enums / no
 * `additionalProperties: false` on operation items — that tripped the API on
 * union-typed fields before). `parsePlan` is the real trust boundary.
 */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: { type: { type: "string", enum: [...OPERATION_TYPES] } },
        required: ["type"],
      },
    },
    needs_clarification: { type: "boolean" },
    clarification_question: { type: ["string", "null"] },
  },
  required: ["operations", "needs_clarification", "clarification_question"],
} as const;

const CUSTOM_KEY_RE = /^[a-z0-9_]{1,40}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEAD_FILTER_KEYS = new Set([
  "status",
  "opportunity",
  "source",
  "created_within",
  "stale_for",
  "search",
  "custom",
]);

// ── plan shapes ──────────────────────────────────────────────────────────────

export interface LeadFilters {
  status: LeadStatusValue[];
  /** Opportunity level == lead temperature (hot / warm / cold). */
  opportunity: LeadTemperatureValue[];
  source: string[];
  /** Restrict to leads created within this rolling window. */
  createdWithin: TimeRangeKey;
  /** Restrict to leads NOT touched (updated_at) within this window — "gone quiet". */
  staleFor: TimeRangeKey;
  /** Free-text match on name / phone / email. */
  search: string | null;
  /** One equality/contains match on an allowlisted industry field in custom_data. */
  custom: { key: string; value: string } | null;
}

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  status: [],
  opportunity: [],
  source: [],
  createdWithin: "all_time",
  staleFor: "all_time",
  search: null,
  custom: null,
};

export type PlannedOperation =
  | { type: "lead_search"; filters: LeadFilters; sort: LeadSort; limit: number }
  | { type: "lead_count"; filters: LeadFilters }
  | {
      type: "lead_count_grouped";
      groupBy: LeadGroupBy;
      timeRange: TimeRangeKey;
    }
  | { type: "pipeline_metrics"; timeRange: TimeRangeKey }
  | { type: "compare_periods"; metric: CompareMetric; period: ComparePeriod }
  | {
      type: "appointment_search";
      status: AppointmentStatusValue[];
      when: AppointmentWhen;
      limit: number;
    }
  | {
      type: "appointment_count";
      status: AppointmentStatusValue[];
      when: AppointmentWhen;
    }
  | { type: "followup_search"; state: FollowupState; limit: number }
  | { type: "lead_details"; leadId: string }
  | { type: "conversion_summary"; timeRange: TimeRangeKey }
  | { type: "activity_search"; timeRange: TimeRangeKey; limit: number };

export interface QueryPlan {
  operations: PlannedOperation[];
  needsClarification: boolean;
  clarificationQuestion: string | null;
}

export type PlanRejectReason =
  | "not_object"
  | "no_operations"
  | "too_many_operations"
  | "unknown_operation"
  | "unknown_field"
  | "invalid_operation";

export type ParsePlanResult =
  | { ok: true; plan: QueryPlan }
  | { ok: false; reason: PlanRejectReason };

// ── validation helpers ───────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Keep only the members of `values` that are in `allow`. Unknown values are dropped. */
function narrowList<T extends string>(
  raw: unknown,
  allow: readonly T[],
): T[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const set = new Set(allow as readonly string[]);
  const out: T[] = [];
  for (const v of arr) {
    if (typeof v === "string" && set.has(v.toLowerCase())) {
      const lc = v.toLowerCase() as T;
      if (!out.includes(lc)) out.push(lc);
    }
  }
  return out;
}

function narrowScalar<T extends string>(
  raw: unknown,
  allow: readonly T[],
  fallback: T | null,
): T | null {
  return typeof raw === "string" &&
    (allow as readonly string[]).includes(raw.toLowerCase())
    ? (raw.toLowerCase() as T)
    : fallback;
}

function narrowTimeRange(raw: unknown): TimeRangeKey {
  return narrowScalar(raw, TIME_RANGE_KEYS, "all_time") ?? "all_time";
}

function clampLimit(raw: unknown, spec: { max: number; default: number }): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return spec.default;
  return Math.min(spec.max, Math.max(1, Math.round(n)));
}

function cleanText(raw: unknown, max = 80): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .replace(/[^\p{L}\p{N}\s@.+_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s.length >= 2 ? s : null;
}

function cleanSourceList(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  for (const v of arr) {
    const s = cleanText(v, 40);
    if (s && !out.includes(s.toLowerCase())) out.push(s.toLowerCase());
  }
  return out.slice(0, 8);
}

/**
 * Validate the `filters` object of a lead operation.
 * Returns `null` when it contains a key outside {@link LEAD_FILTER_KEYS}
 * (an "unknown filter" → the whole plan is rejected).
 */
function parseLeadFilters(raw: unknown): LeadFilters | null {
  const obj = asRecord(raw) ?? {};
  for (const key of Object.keys(obj)) {
    if (!LEAD_FILTER_KEYS.has(key)) return null;
  }

  let custom: LeadFilters["custom"] = null;
  const customRaw = asRecord(obj.custom);
  if (customRaw) {
    const key =
      typeof customRaw.key === "string" ? customRaw.key.toLowerCase() : "";
    const value = cleanText(customRaw.value, 60);
    if (CUSTOM_KEY_RE.test(key) && value) custom = { key, value };
    else if (obj.custom != null && (key || value === null)) {
      // A malformed custom filter the model clearly intended — reject.
      return null;
    }
  } else if (obj.custom != null) {
    return null;
  }

  return {
    status: narrowList(obj.status, LEAD_STATUSES),
    opportunity: narrowList(obj.opportunity, LEAD_TEMPERATURES),
    source: cleanSourceList(obj.source),
    createdWithin: narrowTimeRange(obj.created_within),
    staleFor: narrowTimeRange(obj.stale_for),
    search: cleanText(obj.search, 80),
    custom,
  };
}

const OPERATION_FIELDS: Record<OperationType, ReadonlySet<string>> = {
  lead_search: new Set(["type", "filters", "sort", "limit"]),
  lead_count: new Set(["type", "filters"]),
  lead_count_grouped: new Set(["type", "group_by", "time_range"]),
  pipeline_metrics: new Set(["type", "time_range"]),
  compare_periods: new Set(["type", "metric", "period"]),
  appointment_search: new Set(["type", "status", "when", "limit"]),
  appointment_count: new Set(["type", "status", "when"]),
  followup_search: new Set(["type", "state", "limit"]),
  lead_details: new Set(["type", "lead_id"]),
  conversion_summary: new Set(["type", "time_range"]),
  activity_search: new Set(["type", "time_range", "limit"]),
};

function parseOperation(
  raw: unknown,
):
  | { ok: true; op: PlannedOperation }
  | { ok: false; reason: "unknown_operation" | "unknown_field" | "invalid_operation" } {
  const obj = asRecord(raw);
  if (!obj) return { ok: false, reason: "invalid_operation" };

  const type = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
  if (!(OPERATION_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: "unknown_operation" };
  }
  const opType = type as OperationType;

  for (const key of Object.keys(obj)) {
    if (!OPERATION_FIELDS[opType].has(key)) {
      return { ok: false, reason: "unknown_field" };
    }
  }

  switch (opType) {
    case "lead_search": {
      const filters = parseLeadFilters(obj.filters);
      if (!filters) return { ok: false, reason: "unknown_field" };
      const sort = narrowScalar(obj.sort, LEAD_SORTS, "priority_desc")!;
      return {
        ok: true,
        op: {
          type: "lead_search",
          filters,
          sort,
          limit: clampLimit(obj.limit, LIMITS.lead_search),
        },
      };
    }
    case "lead_count": {
      const filters = parseLeadFilters(obj.filters);
      if (!filters) return { ok: false, reason: "unknown_field" };
      return { ok: true, op: { type: "lead_count", filters } };
    }
    case "lead_count_grouped": {
      const groupBy = narrowScalar(obj.group_by, LEAD_GROUP_BY, null);
      if (!groupBy) return { ok: false, reason: "invalid_operation" };
      return {
        ok: true,
        op: {
          type: "lead_count_grouped",
          groupBy,
          timeRange: narrowTimeRange(obj.time_range),
        },
      };
    }
    case "pipeline_metrics":
      return {
        ok: true,
        op: { type: "pipeline_metrics", timeRange: narrowTimeRange(obj.time_range) },
      };
    case "compare_periods": {
      const metric = narrowScalar(obj.metric, COMPARE_METRICS, null);
      const period = narrowScalar(obj.period, COMPARE_PERIODS, "month");
      if (!metric || !period) return { ok: false, reason: "invalid_operation" };
      return { ok: true, op: { type: "compare_periods", metric, period } };
    }
    case "appointment_search":
      return {
        ok: true,
        op: {
          type: "appointment_search",
          status: narrowList(obj.status, APPOINTMENT_STATUSES),
          when: narrowScalar(obj.when, APPOINTMENT_WHEN, "upcoming")!,
          limit: clampLimit(obj.limit, LIMITS.appointment_search),
        },
      };
    case "appointment_count":
      return {
        ok: true,
        op: {
          type: "appointment_count",
          status: narrowList(obj.status, APPOINTMENT_STATUSES),
          when: narrowScalar(obj.when, APPOINTMENT_WHEN, "upcoming")!,
        },
      };
    case "followup_search": {
      const state = narrowScalar(obj.state, FOLLOWUP_STATES, "open");
      return {
        ok: true,
        op: {
          type: "followup_search",
          state: state!,
          limit: clampLimit(obj.limit, LIMITS.followup_search),
        },
      };
    }
    case "lead_details": {
      const leadId =
        typeof obj.lead_id === "string" && UUID_RE.test(obj.lead_id.trim())
          ? obj.lead_id.trim().toLowerCase()
          : null;
      if (!leadId) return { ok: false, reason: "invalid_operation" };
      return { ok: true, op: { type: "lead_details", leadId } };
    }
    case "conversion_summary":
      return {
        ok: true,
        op: {
          type: "conversion_summary",
          timeRange: narrowTimeRange(obj.time_range),
        },
      };
    case "activity_search":
      return {
        ok: true,
        op: {
          type: "activity_search",
          timeRange: narrowTimeRange(obj.time_range),
          limit: clampLimit(obj.limit, LIMITS.activity_search),
        },
      };
  }
}

/**
 * Validate the planner's raw JSON into a safe {@link QueryPlan}.
 *
 * Unknown operations / filters / fields, an empty plan, or more than
 * {@link MAX_OPERATIONS} operations all fail — the caller then asks for
 * clarification instead of executing anything.
 */
export function parsePlan(raw: unknown): ParsePlanResult {
  const obj = asRecord(raw);
  if (!obj) return { ok: false, reason: "not_object" };

  const needsClarification = obj.needs_clarification === true;
  const clarificationQuestion =
    typeof obj.clarification_question === "string" &&
    obj.clarification_question.trim().length > 0
      ? obj.clarification_question.trim().slice(0, 300)
      : null;

  const rawOps = Array.isArray(obj.operations) ? obj.operations : [];

  // The model asked to clarify and planned nothing — that's a valid plan.
  if (needsClarification && rawOps.length === 0) {
    return { ok: true, plan: { operations: [], needsClarification: true, clarificationQuestion } };
  }

  if (rawOps.length === 0) return { ok: false, reason: "no_operations" };
  if (rawOps.length > MAX_OPERATIONS) {
    return { ok: false, reason: "too_many_operations" };
  }

  const operations: PlannedOperation[] = [];
  for (const rawOp of rawOps) {
    const parsed = parseOperation(rawOp);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    operations.push(parsed.op);
  }

  return {
    ok: true,
    plan: { operations, needsClarification, clarificationQuestion },
  };
}

// ── offline fallback: keyword intent → a single operation ─────────────────────

/**
 * Maps each keyword-router intent (`intents.ts`) to ONE bounded operation, so
 * the offline fallback path (planner API unavailable) reuses the exact same
 * execution + grounding pipeline instead of a parallel set of handlers.
 */
export const INTENT_TO_OPERATION: Record<AskIntent, PlannedOperation> = {
  total_leads: { type: "lead_count", filters: EMPTY_LEAD_FILTERS },
  lead_count_by_status: {
    type: "lead_count_grouped",
    groupBy: "status",
    timeRange: "all_time",
  },
  lead_count_by_opportunity: {
    type: "lead_count_grouped",
    groupBy: "opportunity",
    timeRange: "all_time",
  },
  lead_source_breakdown: {
    type: "lead_count_grouped",
    groupBy: "source",
    timeRange: "all_time",
  },
  qualified_leads: {
    type: "lead_search",
    filters: { ...EMPTY_LEAD_FILTERS, status: ["qualified"] },
    sort: "priority_desc",
    limit: LIMITS.lead_search.default,
  },
  appointment_count: {
    type: "appointment_count",
    status: [],
    when: "upcoming",
  },
  follow_up_count: { type: "followup_search", state: "open", limit: 25 },
  conversion_summary: { type: "conversion_summary", timeRange: "all_time" },
  priority_leads: {
    type: "lead_search",
    filters: EMPTY_LEAD_FILTERS,
    sort: "priority_desc",
    limit: LIMITS.lead_search.default,
  },
  needs_attention: {
    type: "lead_search",
    filters: EMPTY_LEAD_FILTERS,
    sort: "priority_desc",
    limit: LIMITS.lead_search.default,
  },
  at_risk_leads: {
    type: "lead_search",
    filters: EMPTY_LEAD_FILTERS,
    sort: "updated_asc",
    limit: LIMITS.lead_search.default,
  },
  upcoming_appointments: {
    type: "appointment_search",
    status: [],
    when: "upcoming",
    limit: LIMITS.appointment_search.default,
  },
  overdue_followups: { type: "followup_search", state: "overdue", limit: 25 },
  recovery_opportunities: {
    type: "lead_search",
    filters: { ...EMPTY_LEAD_FILTERS, status: ["lost"] },
    sort: "updated_asc",
    limit: LIMITS.lead_search.default,
  },
  recent_activity: {
    type: "activity_search",
    timeRange: "last_7_days",
    limit: LIMITS.activity_search.default,
  },
  pipeline_summary: { type: "pipeline_metrics", timeRange: "all_time" },
  weekly_changes: { type: "activity_search", timeRange: "last_7_days", limit: 12 },
};
