// `getLeadFieldValue` is imported by relative path so this module (and its
// test) run under `node --test`, which does not resolve the `@/` alias for
// value imports. Type-only imports below are erased and can use the alias.
import { getLeadFieldValue, type LeadData } from "../types/chat.ts";
import type {
  ScoringConfig,
  ScoringRule,
  ScoringClassifierId,
} from "@/lib/config/types";

/**
 * Deterministic lead scoring engine.
 *
 * The score is calculated ENTIRELY in application code from the structured
 * lead object and a {@link ScoringConfig} — Claude is never asked to score a
 * lead. The engine is generic: it evaluates the config's {@link ScoringRule}s
 * against the lead's fields and sums the points. Industry-specific weights,
 * thresholds and rules live in the industry template (see
 * `src/lib/config/templates/real-estate.ts`), not here.
 *
 * Rule kinds:
 * - `match`            — exact value → points (e.g. intent "buy" → 15)
 * - `presence`         — field has a usable value → points
 * - `boolean`          — true / false → points
 * - `numericThreshold` — highest tier whose `min` ≤ value → points
 * - `bucket`           — a named classifier maps the value to a bucket → points
 *
 * Temperature bands come from `ScoringConfig.thresholds`.
 */

export type LeadTemperature = "HOT" | "WARM" | "COLD";

/** Points awarded per rule, keyed by the rule's `fieldKey`. */
export type LeadScoreBreakdown = Record<string, number>;

export interface LeadScore {
  /** Sum of every rule's points. */
  score: number;
  temperature: LeadTemperature;
  /** Points per field — lets a dashboard explain *why*. */
  breakdown: LeadScoreBreakdown;
}

// ── value guards ────────────────────────────────────────────────────────────

function isKnownText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** A field "has a value" for `presence` scoring. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "boolean") return true;
  return false;
}

// ── timeline classifier ─────────────────────────────────────────────────────

export type TimelineBucket =
  | "within_1_week"
  | "within_1_month"
  | "within_3_months"
  | "over_3_months"
  | "unknown";

/**
 * Deterministically map a free-text timeline (e.g. "1 week", "3 months",
 * "ASAP", "end of year") to a bucket.
 *
 * - Recognised `N week/day/month/year` phrases are converted to a duration and
 *   bucketed (≤7d → 1 week, ≤31d → 1 month, ≤92d → 3 months, else → over).
 * - A fixed keyword set covers non-numeric phrases.
 * - `null`, empty, or a value that cannot be recognised → `unknown`.
 *   In practice extraction always normalises `timeline` to a clean English
 *   phrase, so the unrecognised case is a safety net, not a common path.
 */
export function classifyTimeline(timeline: unknown): TimelineBucket {
  if (!isKnownText(timeline)) return "unknown";
  const t = timeline.trim().toLowerCase();

  if (/asap|immediat|right away|straight away|urgent|today|tomorrow|this week/.test(t)) {
    return "within_1_week";
  }

  const amount = (unit: RegExp): number | null => {
    const match = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*\\+?\\s*(?:${unit.source})`));
    return match ? Number.parseFloat(match[1]) : null;
  };

  const days = amount(/days?/);
  if (days !== null) {
    if (days <= 7) return "within_1_week";
    if (days <= 31) return "within_1_month";
    if (days <= 92) return "within_3_months";
    return "over_3_months";
  }

  const weeks = amount(/weeks?/);
  if (weeks !== null) {
    if (weeks <= 1) return "within_1_week";
    if (weeks <= 4) return "within_1_month";
    if (weeks <= 13) return "within_3_months";
    return "over_3_months";
  }

  const months = amount(/months?/);
  if (months !== null) {
    if (months <= 1) return "within_1_month";
    if (months <= 3) return "within_3_months";
    return "over_3_months";
  }

  if (amount(/years?/) !== null) return "over_3_months";

  if (/within a week|in a week|one week|a week/.test(t)) return "within_1_week";
  if (/within a month|in a month|one month|a month|this month|next month|end of month|month or so/.test(t)) {
    return "within_1_month";
  }
  if (/quarter|couple of months|few months|by summer|by spring/.test(t)) {
    return "within_3_months";
  }
  if (/soon/.test(t)) return "within_1_month";
  if (/flexible|no rush|no hurry|not sure|no timeline|just (browsing|looking|exploring)|someday|eventually|later|end of year|next year|long[- ]term|whenever|half a year/.test(t)) {
    return "over_3_months";
  }

  return "unknown";
}

/** Named deterministic classifiers a `bucket` rule can reference. */
const CLASSIFIERS: Record<ScoringClassifierId, (value: unknown) => string> = {
  timeline: classifyTimeline,
};

// ── rule evaluation ─────────────────────────────────────────────────────────

function evaluateRule(rule: ScoringRule, value: unknown): number {
  switch (rule.kind) {
    case "match": {
      if (value === null || value === undefined) return rule.whenMissing;
      const points = rule.cases[String(value)];
      return typeof points === "number" ? points : rule.whenMissing;
    }
    case "presence":
      return isPresent(value) ? rule.points : rule.whenMissing;
    case "boolean":
      if (value === true) return rule.whenTrue;
      if (value === false) return rule.whenFalse;
      return rule.whenMissing;
    case "numericThreshold": {
      if (!isPositiveNumber(value)) return rule.whenMissing;
      const tier = [...rule.tiers]
        .sort((a, b) => b.min - a.min)
        .find((t) => value >= t.min);
      return tier ? tier.points : rule.whenMissing;
    }
    case "bucket": {
      const classifier = CLASSIFIERS[rule.classifier];
      if (!classifier) return rule.whenMissing;
      const points = rule.buckets[classifier(value)];
      return typeof points === "number" ? points : rule.whenMissing;
    }
    default: {
      // Unknown rule kind (malformed config) — award nothing.
      return 0;
    }
  }
}

function classifyTemperature(
  score: number,
  { hot, warm }: ScoringConfig["thresholds"],
): LeadTemperature {
  if (score >= hot) return "HOT";
  if (score >= warm) return "WARM";
  return "COLD";
}

// ── public API ─────────────────────────────────────────────────────────────

/** Maximum points each field can contribute, keyed by field key. */
export function scoreWeights(scoring: ScoringConfig): LeadScoreBreakdown {
  const weights: LeadScoreBreakdown = {};
  for (const rule of scoring.rules) weights[rule.fieldKey] = rule.maxPoints;
  return weights;
}

/** The maximum score this configuration can produce. */
export function maxScore(scoring: ScoringConfig): number {
  return scoring.rules.reduce((total, rule) => total + rule.maxPoints, 0);
}

/**
 * Calculate a lead's score, temperature and per-field breakdown from the
 * structured lead and a scoring configuration. Pure and side-effect free.
 * Tolerates a malformed or partial lead — unknown values simply score their
 * rule's `whenMissing`.
 */
export function calculateLeadScore(
  lead: LeadData,
  scoring: ScoringConfig,
): LeadScore {
  const rules = Array.isArray(scoring?.rules) ? scoring.rules : [];
  const breakdown: LeadScoreBreakdown = {};
  let score = 0;

  for (const rule of rules) {
    if (!rule || typeof rule.fieldKey !== "string") continue;
    // The value is resolved from the lead whether the field is a core field
    // or lives in customData — the engine does not care.
    const points = evaluateRule(rule, getLeadFieldValue(lead, rule.fieldKey));
    breakdown[rule.fieldKey] = points;
    score += points;
  }

  const thresholds = scoring?.thresholds ?? { hot: 80, warm: 50 };
  return { score, temperature: classifyTemperature(score, thresholds), breakdown };
}
