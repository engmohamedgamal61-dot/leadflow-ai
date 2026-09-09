/**
 * Ask LeadFlow — the structured natural-language interpretation layer.
 *
 * Pure, dependency-light and deterministic. One small Anthropic call
 * (`answer.ts` `interpretQuestion`) turns the user's free-text question into a
 * bounded JSON object; THIS module is the security boundary that validates it.
 *
 * The model may interpret language, but it can never widen the surface:
 *   - `intent` MUST be one of the allowlisted {@link ASK_INTENTS}. An unknown
 *     or injected value is rejected — it is NEVER silently mapped to a default.
 *   - `filters` are narrowed to known lead statuses / temperatures; `source` is
 *     sanitised to a short plain token.
 *   - `time_range` is one of a fixed set of rolling windows.
 *   - `limit` is clamped to the card budget.
 *
 * A rejected or low-confidence interpretation makes the orchestrator ask a
 * short clarifying question instead of guessing.
 */

import { ASK_INTENTS, type AskIntent } from "./intents.ts";
import {
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  type LeadStatusValue,
  type LeadTemperatureValue,
} from "../leads/list-params.ts";

/** Below this the orchestrator asks for clarification rather than acting. */
export const CONFIDENCE_CLARIFY_THRESHOLD = 0.45;

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

export interface InterpretationFilters {
  status: LeadStatusValue | null;
  temperature: LeadTemperatureValue | null;
  /** A short, sanitised lead-source token (e.g. "whatsapp", "web"), or null. */
  source: string | null;
}

export interface Interpretation {
  intent: AskIntent;
  filters: InterpretationFilters;
  timeRange: TimeRangeKey;
  /** Requested list size, clamped 1..8, or null for "use the default". */
  limit: number | null;
  /** The model's own certainty, 0..1. */
  confidence: number;
  /** The model flagged the question as ambiguous / unanswerable. */
  needsClarification: boolean;
  /** A short question to put back to the user, already in their language. */
  clarificationQuestion: string | null;
}

/** Retrieval parameters derived from a validated {@link Interpretation}. */
export interface IntentParams {
  filters: InterpretationFilters;
  timeRange: TimeRangeKey;
  limit: number | null;
}

export const DEFAULT_INTENT_PARAMS: IntentParams = {
  filters: { status: null, temperature: null, source: null },
  timeRange: "all_time",
  limit: null,
};

/**
 * JSON schema handed to Anthropic `output_config` so the interpretation call
 * comes back as a bounded object. `parseInterpretation` re-validates every
 * field regardless — the schema is a convenience, not the trust boundary.
 */
export const INTERPRETATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: [...ASK_INTENTS] },
    filters: {
      type: "object",
      additionalProperties: false,
      properties: {
        // Nullable free-text here — `parseInterpretation` is the real gate and
        // narrows these to the known status / temperature / source values.
        status: { type: ["string", "null"] },
        temperature: { type: ["string", "null"] },
        source: { type: ["string", "null"] },
      },
      required: ["status", "temperature", "source"],
    },
    time_range: { type: "string", enum: [...TIME_RANGE_KEYS] },
    limit: { type: ["integer", "null"] },
    confidence: { type: "number" },
    needs_clarification: { type: "boolean" },
    clarification_question: { type: ["string", "null"] },
  },
  required: [
    "intent",
    "filters",
    "time_range",
    "limit",
    "confidence",
    "needs_clarification",
    "clarification_question",
  ],
} as const;

export type ParseResult =
  | { ok: true; value: Interpretation }
  | { ok: false; reason: "not_object" | "unknown_intent" };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function sanitizeSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return s.length >= 2 ? s : null;
}

function clampConfidence(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clampLimit(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < 1) return null;
  return Math.min(8, i);
}

/**
 * Validate the model's raw JSON into a safe {@link Interpretation}.
 *
 * An unknown / injected `intent` returns `{ ok: false }` — the caller MUST then
 * ask for clarification, never fall back to a real intent.
 */
export function parseInterpretation(raw: unknown): ParseResult {
  const obj = asRecord(raw);
  if (!obj) return { ok: false, reason: "not_object" };

  const intent = obj.intent;
  if (
    typeof intent !== "string" ||
    !(ASK_INTENTS as readonly string[]).includes(intent)
  ) {
    return { ok: false, reason: "unknown_intent" };
  }

  const filtersRaw = asRecord(obj.filters) ?? {};
  const statusRaw =
    typeof filtersRaw.status === "string"
      ? filtersRaw.status.toLowerCase()
      : "";
  const tempRaw =
    typeof filtersRaw.temperature === "string"
      ? filtersRaw.temperature.toLowerCase()
      : "";

  const timeRaw =
    typeof obj.time_range === "string" ? obj.time_range.toLowerCase() : "";
  const timeRange = (TIME_RANGE_KEYS as readonly string[]).includes(timeRaw)
    ? (timeRaw as TimeRangeKey)
    : "all_time";

  const clarificationQuestion =
    typeof obj.clarification_question === "string" &&
    obj.clarification_question.trim().length > 0
      ? obj.clarification_question.trim().slice(0, 300)
      : null;

  return {
    ok: true,
    value: {
      intent: intent as AskIntent,
      filters: {
        status: (LEAD_STATUSES as readonly string[]).includes(statusRaw)
          ? (statusRaw as LeadStatusValue)
          : null,
        temperature: (LEAD_TEMPERATURES as readonly string[]).includes(tempRaw)
          ? (tempRaw as LeadTemperatureValue)
          : null,
        source: sanitizeSource(filtersRaw.source),
      },
      timeRange,
      limit: clampLimit(obj.limit),
      confidence: clampConfidence(obj.confidence),
      needsClarification: obj.needs_clarification === true,
      clarificationQuestion,
    },
  };
}

/** Should the orchestrator ask a clarifying question instead of acting? */
export function shouldClarify(value: Interpretation): boolean {
  return (
    value.needsClarification ||
    value.confidence < CONFIDENCE_CLARIFY_THRESHOLD
  );
}

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
 * Turn a {@link TimeRangeKey} into concrete bounds. Windows are rolling and
 * UTC-based, consistent with the dashboard trend queries (`getDashboardTrends`
 * uses last-7 vs previous-7). `all_time` is unbounded.
 */
export function resolveTimeRange(key: TimeRangeKey, now: Date = new Date()): ResolvedRange {
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
