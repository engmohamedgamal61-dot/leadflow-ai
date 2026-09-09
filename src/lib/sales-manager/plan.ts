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
  "lead_lookup",
  "lead_details",
  "conversion_summary",
  "activity_search",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

/** The only fields `lead_lookup` may resolve a human reference by. */
export const LEAD_LOOKUP_BY = ["name", "phone", "email"] as const;
export type LeadLookupBy = (typeof LEAD_LOOKUP_BY)[number];

/**
 * Below this planner-reported confidence the orchestrator asks a clarifying
 * question instead of executing a possibly-wrong query. Deliberately
 * conservative — harmless wording differences must NOT trigger a clarification.
 */
export const CONFIDENCE_CLARIFY_THRESHOLD = 0.4;

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

/** Hard cap on candidates `lead_lookup` returns before it must disambiguate. */
export const LEAD_LOOKUP_MAX_CANDIDATES = 6;

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
    confidence: { type: "number" },
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
  | { type: "lead_lookup"; by: LeadLookupBy; value: string }
  | { type: "lead_details"; leadId: string }
  | { type: "conversion_summary"; timeRange: TimeRangeKey }
  | { type: "activity_search"; timeRange: TimeRangeKey; limit: number };

export interface QueryPlan {
  operations: PlannedOperation[];
  needsClarification: boolean;
  clarificationQuestion: string | null;
  /** Planner-reported certainty, 0..1. Defaults to 1 when the planner omits it. */
  confidence: number;
}

export type PlanRejectReason =
  | "not_object"
  | "no_operations"
  | "too_many_operations"
  | "unknown_operation"
  | "unknown_field"
  | "invalid_operation"
  /** An explicitly-provided enum value that isn't in the allowlist — dropping it
   *  would change the meaning of the request, so the whole plan is refused. */
  | "unsupported_filter_value"
  /** `confidence` was present but not a number in [0,1]. */
  | "invalid_confidence";

export type ParsePlanResult =
  | { ok: true; plan: QueryPlan }
  | {
      ok: false;
      reason: PlanRejectReason;
      /** For `unsupported_filter_value`: the filter/field and the offending value. */
      field?: string;
      value?: string;
    };

// ── validation helpers ───────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

type ListResult<T> =
  | { ok: true; values: T[] }
  | { ok: false; value: string };

/**
 * Validate every member of a filter list against an allowlist. Empty / blank
 * entries are ignored; a genuinely unknown value FAILS (the caller rejects the
 * plan) rather than being silently dropped — dropping "enterprise" from
 * `["hot","enterprise"]` would misrepresent the request.
 */
function narrowListStrict<T extends string>(
  raw: unknown,
  allow: readonly T[],
): ListResult<T> {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const set = new Set(allow as readonly string[]);
  const out: T[] = [];
  for (const v of arr) {
    if (typeof v !== "string") {
      if (v == null) continue;
      return { ok: false, value: String(v) };
    }
    const lc = v.trim().toLowerCase();
    if (lc === "") continue;
    if (!set.has(lc)) return { ok: false, value: v.trim() };
    if (!out.includes(lc as T)) out.push(lc as T);
  }
  return { ok: true, values: out };
}

type ScalarResult<T> =
  | { ok: true; value: T }
  | { ok: false; value: string };

/**
 * Validate a single enum-ish field. Absent → `fallback` (no clarification).
 * Present but unrecognised → FAIL (a wrong sort / period / state changes the
 * answer's meaning).
 */
function narrowScalarStrict<T extends string>(
  raw: unknown,
  allow: readonly T[],
  fallback: T,
): ScalarResult<T> {
  if (raw == null || raw === "") return { ok: true, value: fallback };
  if (typeof raw !== "string") return { ok: false, value: String(raw) };
  const lc = raw.trim().toLowerCase();
  if ((allow as readonly string[]).includes(lc)) return { ok: true, value: lc as T };
  return { ok: false, value: raw.trim() };
}

/** Non-strict — a bad time range is harmless (defaults to all_time). */
function narrowTimeRange(raw: unknown): TimeRangeKey {
  if (typeof raw === "string" && (TIME_RANGE_KEYS as readonly string[]).includes(raw.toLowerCase())) {
    return raw.toLowerCase() as TimeRangeKey;
  }
  return "all_time";
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

type OpFail = {
  ok: false;
  reason: PlanRejectReason;
  field?: string;
  value?: string;
};

/**
 * Validate the `filters` object of a lead operation. An unknown filter key, a
 * malformed `custom`, or an explicitly-provided invalid enum value all FAIL —
 * the whole plan is then refused (never silently narrowed).
 */
function parseLeadFilters(raw: unknown): { ok: true; filters: LeadFilters } | OpFail {
  const obj = asRecord(raw) ?? {};
  for (const key of Object.keys(obj)) {
    if (!LEAD_FILTER_KEYS.has(key)) {
      return { ok: false, reason: "unknown_field", field: key };
    }
  }

  let custom: LeadFilters["custom"] = null;
  if (obj.custom != null) {
    const customRaw = asRecord(obj.custom);
    const key =
      customRaw && typeof customRaw.key === "string"
        ? customRaw.key.trim().toLowerCase()
        : "";
    const value = customRaw ? cleanText(customRaw.value, 60) : null;
    if (CUSTOM_KEY_RE.test(key) && value) custom = { key, value };
    else return { ok: false, reason: "unsupported_filter_value", field: "custom", value: key || "?" };
  }

  const status = narrowListStrict(obj.status, LEAD_STATUSES);
  if (!status.ok) {
    return { ok: false, reason: "unsupported_filter_value", field: "status", value: status.value };
  }
  const opportunity = narrowListStrict(obj.opportunity, LEAD_TEMPERATURES);
  if (!opportunity.ok) {
    return {
      ok: false,
      reason: "unsupported_filter_value",
      field: "opportunity",
      value: opportunity.value,
    };
  }
  const createdWithin = narrowScalarStrict(obj.created_within, TIME_RANGE_KEYS, "all_time");
  if (!createdWithin.ok) {
    return {
      ok: false,
      reason: "unsupported_filter_value",
      field: "created_within",
      value: createdWithin.value,
    };
  }
  const staleFor = narrowScalarStrict(obj.stale_for, TIME_RANGE_KEYS, "all_time");
  if (!staleFor.ok) {
    return {
      ok: false,
      reason: "unsupported_filter_value",
      field: "stale_for",
      value: staleFor.value,
    };
  }

  return {
    ok: true,
    filters: {
      status: status.values,
      opportunity: opportunity.values,
      source: cleanSourceList(obj.source),
      createdWithin: createdWithin.value,
      staleFor: staleFor.value,
      search: cleanText(obj.search, 80),
      custom,
    },
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
  lead_lookup: new Set(["type", "by", "value"]),
  lead_details: new Set(["type", "lead_id"]),
  conversion_summary: new Set(["type", "time_range"]),
  activity_search: new Set(["type", "time_range", "limit"]),
};

function parseOperation(raw: unknown): { ok: true; op: PlannedOperation } | OpFail {
  const obj = asRecord(raw);
  if (!obj) return { ok: false, reason: "invalid_operation" };

  const type = typeof obj.type === "string" ? obj.type.toLowerCase() : "";
  if (!(OPERATION_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: "unknown_operation", value: type };
  }
  const opType = type as OperationType;

  for (const key of Object.keys(obj)) {
    if (!OPERATION_FIELDS[opType].has(key)) {
      return { ok: false, reason: "unknown_field", field: key };
    }
  }

  switch (opType) {
    case "lead_search": {
      const f = parseLeadFilters(obj.filters);
      if (!f.ok) return f;
      const sort = narrowScalarStrict(obj.sort, LEAD_SORTS, "priority_desc");
      if (!sort.ok) {
        return { ok: false, reason: "unsupported_filter_value", field: "sort", value: sort.value };
      }
      return {
        ok: true,
        op: {
          type: "lead_search",
          filters: f.filters,
          sort: sort.value,
          limit: clampLimit(obj.limit, LIMITS.lead_search),
        },
      };
    }
    case "lead_count": {
      const f = parseLeadFilters(obj.filters);
      if (!f.ok) return f;
      return { ok: true, op: { type: "lead_count", filters: f.filters } };
    }
    case "lead_count_grouped": {
      const groupBy = narrowScalarStrict(obj.group_by, LEAD_GROUP_BY, "" as LeadGroupBy);
      if (!groupBy.ok || !(groupBy.value as string)) {
        return {
          ok: false,
          reason: "unsupported_filter_value",
          field: "group_by",
          value: groupBy.ok ? "(missing)" : groupBy.value,
        };
      }
      return {
        ok: true,
        op: {
          type: "lead_count_grouped",
          groupBy: groupBy.value,
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
      const metric = narrowScalarStrict(obj.metric, COMPARE_METRICS, "" as CompareMetric);
      if (!metric.ok || !(metric.value as string)) {
        return {
          ok: false,
          reason: "unsupported_filter_value",
          field: "metric",
          value: metric.ok ? "(missing)" : metric.value,
        };
      }
      const period = narrowScalarStrict(obj.period, COMPARE_PERIODS, "month");
      if (!period.ok) {
        return { ok: false, reason: "unsupported_filter_value", field: "period", value: period.value };
      }
      return { ok: true, op: { type: "compare_periods", metric: metric.value, period: period.value } };
    }
    case "appointment_search": {
      const status = narrowListStrict(obj.status, APPOINTMENT_STATUSES);
      if (!status.ok) {
        return { ok: false, reason: "unsupported_filter_value", field: "status", value: status.value };
      }
      const when = narrowScalarStrict(obj.when, APPOINTMENT_WHEN, "upcoming");
      if (!when.ok) {
        return { ok: false, reason: "unsupported_filter_value", field: "when", value: when.value };
      }
      return {
        ok: true,
        op: {
          type: "appointment_search",
          status: status.values,
          when: when.value,
          limit: clampLimit(obj.limit, LIMITS.appointment_search),
        },
      };
    }
    case "appointment_count": {
      const status = narrowListStrict(obj.status, APPOINTMENT_STATUSES);
      if (!status.ok) {
        return { ok: false, reason: "unsupported_filter_value", field: "status", value: status.value };
      }
      const when = narrowScalarStrict(obj.when, APPOINTMENT_WHEN, "upcoming");
      if (!when.ok) {
        return { ok: false, reason: "unsupported_filter_value", field: "when", value: when.value };
      }
      return {
        ok: true,
        op: { type: "appointment_count", status: status.values, when: when.value },
      };
    }
    case "followup_search": {
      const state = narrowScalarStrict(obj.state, FOLLOWUP_STATES, "open");
      if (!state.ok) {
        return { ok: false, reason: "unsupported_filter_value", field: "state", value: state.value };
      }
      return {
        ok: true,
        op: {
          type: "followup_search",
          state: state.value,
          limit: clampLimit(obj.limit, LIMITS.followup_search),
        },
      };
    }
    case "lead_lookup": {
      const by = narrowScalarStrict(obj.by, LEAD_LOOKUP_BY, "name");
      if (!by.ok) {
        return { ok: false, reason: "unsupported_filter_value", field: "by", value: by.value };
      }
      const value =
        by.value === "phone"
          ? (typeof obj.value === "string" ? obj.value.replace(/[^\d+]/g, "").slice(0, 24) : "")
          : (cleanText(obj.value, 120) ?? "");
      if (value.replace(/\D/g, "").length < 3 && by.value === "phone") {
        return { ok: false, reason: "invalid_operation", field: "value" };
      }
      if (by.value !== "phone" && value.length < 2) {
        return { ok: false, reason: "invalid_operation", field: "value" };
      }
      return { ok: true, op: { type: "lead_lookup", by: by.value, value } };
    }
    case "lead_details": {
      const leadId =
        typeof obj.lead_id === "string" && UUID_RE.test(obj.lead_id.trim())
          ? obj.lead_id.trim().toLowerCase()
          : null;
      if (!leadId) return { ok: false, reason: "invalid_operation", field: "lead_id" };
      return { ok: true, op: { type: "lead_details", leadId } };
    }
    case "conversion_summary":
      return {
        ok: true,
        op: { type: "conversion_summary", timeRange: narrowTimeRange(obj.time_range) },
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

function parseConfidence(raw: unknown): { ok: true; value: number } | { ok: false } {
  if (raw == null) return { ok: true, value: 1 };
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    return { ok: false };
  }
  return { ok: true, value: raw };
}

/**
 * Validate the planner's raw JSON into a safe {@link QueryPlan}.
 *
 * Unknown operations / filters / fields, an unsupported enum value, an invalid
 * `confidence`, an empty plan, or more than {@link MAX_OPERATIONS} operations
 * all fail — the caller then asks for clarification instead of executing
 * anything.
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

  const confidence = parseConfidence(obj.confidence);
  if (!confidence.ok) return { ok: false, reason: "invalid_confidence" };

  const rawOps = Array.isArray(obj.operations) ? obj.operations : [];

  // The model asked to clarify and planned nothing — that's a valid plan.
  if (needsClarification && rawOps.length === 0) {
    return {
      ok: true,
      plan: {
        operations: [],
        needsClarification: true,
        clarificationQuestion,
        confidence: confidence.value,
      },
    };
  }

  if (rawOps.length === 0) return { ok: false, reason: "no_operations" };
  if (rawOps.length > MAX_OPERATIONS) {
    return { ok: false, reason: "too_many_operations" };
  }

  const operations: PlannedOperation[] = [];
  for (const rawOp of rawOps) {
    const parsed = parseOperation(rawOp);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason, field: parsed.field, value: parsed.value };
    }
    operations.push(parsed.op);
  }

  return {
    ok: true,
    plan: {
      operations,
      needsClarification,
      clarificationQuestion,
      confidence: confidence.value,
    },
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
