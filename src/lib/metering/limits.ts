/**
 * Usage-limit evaluation. Pure — deterministic for a given (totals, limits).
 *
 * Three independent dimensions (tokens, requests, cost) each get an optional
 * monthly limit. A dimension is `warn` once usage crosses the org's warning
 * threshold, `exceeded` once it reaches the limit. The overall state:
 *
 *   - no limit set on any dimension           → always `ok` (existing behaviour)
 *   - a dimension exceeded, hard limit ON     → `block`
 *   - a dimension exceeded, hard limit OFF    → `warn` (advisory only)
 *   - a dimension in the warning band         → `warn`
 *   - otherwise                               → `ok`
 *
 * Enforcement uses {@link LimitEvaluation.allowNewRequests}. The dashboard uses
 * the per-dimension detail to render progress bars and warning copy.
 */

export interface UsageLimits {
  monthlyTokenLimit: number | null;
  monthlyRequestLimit: number | null;
  monthlyCostLimitUsd: number | null;
  /** 1–100. */
  warningThresholdPercent: number;
  hardLimitEnabled: boolean;
}

export interface UsageTotals {
  totalTokens: number;
  totalRequests: number;
  totalCostUsd: number;
}

export type DimensionState = "ok" | "warn" | "exceeded";
export type LimitState = "ok" | "warn" | "block";
export type UsageDimension = "tokens" | "requests" | "cost";

export interface DimensionEvaluation {
  dimension: UsageDimension;
  /** `null` when this dimension has no configured limit. */
  limit: number | null;
  used: number;
  /** `used / limit`, clamped to ≥ 0; `null` when unlimited. */
  ratio: number | null;
  state: DimensionState;
  /** Remaining headroom before the limit (never negative); `null` when unlimited. */
  remaining: number | null;
}

export interface LimitEvaluation {
  state: LimitState;
  /** False only when a hard limit is enabled AND a limited dimension is exceeded. */
  allowNewRequests: boolean;
  hardLimitEnabled: boolean;
  /** True when at least one dimension has a configured limit. */
  anyLimitConfigured: boolean;
  dimensions: Record<UsageDimension, DimensionEvaluation>;
  /** Dimensions currently `warn` or `exceeded`, for the UI. */
  triggered: UsageDimension[];
}

/** The default used when no `organization_usage_limits` row exists. */
export const NO_LIMITS: UsageLimits = {
  monthlyTokenLimit: null,
  monthlyRequestLimit: null,
  monthlyCostLimitUsd: null,
  warningThresholdPercent: 80,
  hardLimitEnabled: false,
};

function clampThreshold(percent: number): number {
  if (!Number.isFinite(percent)) return 80;
  return Math.min(100, Math.max(1, Math.round(percent)));
}

function evaluateDimension(
  dimension: UsageDimension,
  used: number,
  limit: number | null,
  thresholdRatio: number,
): DimensionEvaluation {
  const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
  if (limit === null || !Number.isFinite(limit) || limit <= 0) {
    return { dimension, limit: limit && limit > 0 ? limit : null, used: safeUsed, ratio: null, state: "ok", remaining: null };
  }
  const ratio = safeUsed / limit;
  const state: DimensionState =
    ratio >= 1 ? "exceeded" : ratio >= thresholdRatio ? "warn" : "ok";
  return {
    dimension,
    limit,
    used: safeUsed,
    ratio,
    state,
    remaining: Math.max(0, limit - safeUsed),
  };
}

export function evaluateUsageLimits(
  totals: UsageTotals,
  limits: UsageLimits,
): LimitEvaluation {
  const thresholdRatio = clampThreshold(limits.warningThresholdPercent) / 100;

  const dimensions: Record<UsageDimension, DimensionEvaluation> = {
    tokens: evaluateDimension("tokens", totals.totalTokens, limits.monthlyTokenLimit, thresholdRatio),
    requests: evaluateDimension("requests", totals.totalRequests, limits.monthlyRequestLimit, thresholdRatio),
    cost: evaluateDimension("cost", totals.totalCostUsd, limits.monthlyCostLimitUsd, thresholdRatio),
  };

  const list = Object.values(dimensions);
  const anyLimitConfigured = list.some((d) => d.limit !== null);
  const anyExceeded = list.some((d) => d.state === "exceeded");
  const anyWarn = list.some((d) => d.state === "warn");

  const allowNewRequests = !(limits.hardLimitEnabled && anyExceeded);
  const state: LimitState = !anyLimitConfigured
    ? "ok"
    : !allowNewRequests
      ? "block"
      : anyExceeded || anyWarn
        ? "warn"
        : "ok";

  return {
    state,
    allowNewRequests,
    hardLimitEnabled: limits.hardLimitEnabled,
    anyLimitConfigured,
    dimensions,
    triggered: list.filter((d) => d.state !== "ok").map((d) => d.dimension),
  };
}
