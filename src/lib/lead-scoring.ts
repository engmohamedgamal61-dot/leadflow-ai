import type { LeadData } from "@/types/chat";

/**
 * Deterministic lead scoring.
 *
 * The score is calculated ENTIRELY in application code from the structured
 * {@link LeadData} object — Claude is never asked to score a lead. The model is
 * transparent, predictable and easy to tune: every category has a fixed weight
 * and a small, readable scoring function.
 *
 * ┌───────────────┬─────┬────────────────────────────────────────────────────┐
 * │ Category      │ Max │ Rule                                               │
 * ├───────────────┼─────┼────────────────────────────────────────────────────┤
 * │ intent        │  15 │ buy = 15 · rent = 10 · null = 0                     │
 * │ budget (SAR)  │  20 │ ≥1,000,000 = 20 · ≥500,000 = 15 · ≥250,000 = 10 ·   │
 * │               │     │ >0 = 5 · null = 0                                   │
 * │ location      │  10 │ known = 10 · null = 0                               │
 * │ property_type │  10 │ known = 10 · null = 0                               │
 * │ bedrooms      │  10 │ known = 10 · null = 0                               │
 * │ financing     │  15 │ true = 15 · false = 10 · null = 0                   │
 * │ timeline      │  20 │ ≤1 week = 20 · ≤1 month = 15 · ≤3 months = 10 ·     │
 * │               │     │ >3 months = 5 · null = 0                            │
 * └───────────────┴─────┴────────────────────────────────────────────────────┘
 * Total maximum = 100.
 *
 * Temperature: 80–100 HOT · 50–79 WARM · 0–49 COLD.
 *
 * To change the model, edit {@link SCORE_WEIGHTS}, {@link TEMPERATURE_THRESHOLDS},
 * or the individual `score*` helpers below — nothing else depends on the
 * internals.
 */

export type LeadTemperature = "HOT" | "WARM" | "COLD";

export interface LeadScoreBreakdown {
  intent: number;
  budget: number;
  location: number;
  property_type: number;
  bedrooms: number;
  financing: number;
  timeline: number;
}

export interface LeadScore {
  /** 0–100, the sum of every category in {@link LeadScoreBreakdown}. */
  score: number;
  temperature: LeadTemperature;
  /** Points awarded per category — lets a dashboard explain *why*. */
  breakdown: LeadScoreBreakdown;
}

/** Maximum points each category can contribute. Sums to 100. */
export const SCORE_WEIGHTS: LeadScoreBreakdown = {
  intent: 15,
  budget: 20,
  location: 10,
  property_type: 10,
  bedrooms: 10,
  financing: 15,
  timeline: 20,
};

/** Lower bound (inclusive) of each temperature band. */
export const TEMPERATURE_THRESHOLDS = { HOT: 80, WARM: 50 } as const;

// ── value guards ────────────────────────────────────────────────────────────

function isKnownText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// ── per-category scoring ────────────────────────────────────────────────────

function scoreIntent(intent: unknown): number {
  if (intent === "buy") return 15;
  if (intent === "rent") return 10;
  return 0;
}

function scoreBudget(budget: unknown): number {
  if (!isPositiveNumber(budget)) return 0;
  if (budget >= 1_000_000) return 20;
  if (budget >= 500_000) return 15;
  if (budget >= 250_000) return 10;
  return 5;
}

function scoreLocation(location: unknown): number {
  return isKnownText(location) ? 10 : 0;
}

function scorePropertyType(propertyType: unknown): number {
  return isKnownText(propertyType) ? 10 : 0;
}

function scoreBedrooms(bedrooms: unknown): number {
  return isPositiveNumber(bedrooms) ? 10 : 0;
}

function scoreFinancing(financing: unknown): number {
  if (financing === true) return 15;
  if (financing === false) return 10;
  return 0;
}

export type TimelineBucket =
  | "within_1_week"
  | "within_1_month"
  | "within_3_months"
  | "over_3_months"
  | "unknown";

const TIMELINE_BUCKET_POINTS: Record<TimelineBucket, number> = {
  within_1_week: 20,
  within_1_month: 15,
  within_3_months: 10,
  over_3_months: 5,
  unknown: 0,
};

/**
 * Deterministically map a free-text timeline (e.g. "1 week", "3 months",
 * "ASAP", "end of year") to a bucket.
 *
 * - Recognised `N week/day/month/year` phrases are converted to a duration and
 *   bucketed (≤7d → 1 week, ≤31d → 1 month, ≤92d → 3 months, else → over).
 * - A fixed keyword set covers non-numeric phrases.
 * - `null`, empty, or a value that cannot be recognised → `unknown` (0 points).
 *   In practice extraction always normalises `timeline` to a clean English
 *   phrase, so the unrecognised case is a safety net, not a common path.
 */
export function classifyTimeline(timeline: unknown): TimelineBucket {
  if (!isKnownText(timeline)) return "unknown";
  const t = timeline.trim().toLowerCase();

  // Urgency phrases → within a week.
  if (/asap|immediat|right away|straight away|urgent|today|tomorrow|this week/.test(t)) {
    return "within_1_week";
  }

  // "<number> <unit>" phrases, most specific unit first.
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

  // Non-numeric phrases.
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

  // Present but unrecognised — treat as unknown (0 points) rather than
  // awarding points we cannot justify.
  return "unknown";
}

function scoreTimeline(timeline: unknown): number {
  return TIMELINE_BUCKET_POINTS[classifyTimeline(timeline)];
}

// ── public API ─────────────────────────────────────────────────────────────

function classifyTemperature(score: number): LeadTemperature {
  if (score >= TEMPERATURE_THRESHOLDS.HOT) return "HOT";
  if (score >= TEMPERATURE_THRESHOLDS.WARM) return "WARM";
  return "COLD";
}

/**
 * Calculate a lead's score (0–100), temperature and per-category breakdown
 * from the structured {@link LeadData}. Pure and side-effect free. Tolerates a
 * malformed or partial object at runtime — unknown values simply score 0.
 */
export function calculateLeadScore(lead: LeadData): LeadScore {
  const source = (
    lead && typeof lead === "object" ? lead : {}
  ) as Partial<Record<keyof LeadData, unknown>>;

  const breakdown: LeadScoreBreakdown = {
    intent: scoreIntent(source.intent),
    budget: scoreBudget(source.budget),
    location: scoreLocation(source.location),
    property_type: scorePropertyType(source.property_type),
    bedrooms: scoreBedrooms(source.bedrooms),
    financing: scoreFinancing(source.financing),
    timeline: scoreTimeline(source.timeline),
  };

  const score =
    breakdown.intent +
    breakdown.budget +
    breakdown.location +
    breakdown.property_type +
    breakdown.bedrooms +
    breakdown.financing +
    breakdown.timeline;

  return { score, temperature: classifyTemperature(score), breakdown };
}
