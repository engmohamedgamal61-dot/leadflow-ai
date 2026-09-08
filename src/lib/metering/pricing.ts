/**
 * Centralized Anthropic model pricing — the ONE place cost rates live.
 *
 * Pure and dependency-free. Nothing in the business logic hardcodes a rate;
 * every cost estimate goes through {@link estimateCostUsd}. Rates are USD per
 * million tokens (MTok), matching Anthropic's public pricing.
 *
 * Updating pricing later is a data change, not a code change:
 *   - edit {@link MODEL_PRICING} for a permanent update, or
 *   - set the server-only `AI_PRICING_OVERRIDES_JSON` env var (a JSON object of
 *     `{ "<model>": { "inputPerMTok": n, "outputPerMTok": n,
 *        "cacheReadPerMTok"?: n, "cacheWritePerMTok"?: n } }`) to override
 *     without a deploy. Overrides are merged over the defaults per model.
 *
 * Designed for future model routing / billing plans: a plan can carry its own
 * override map and pass it to {@link estimateCostUsd}.
 */

export interface ModelPricing {
  /** USD per million input tokens (uncached). */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** USD per million cache-read input tokens (~0.1x input by default). */
  cacheReadPerMTok: number;
  /** USD per million cache-write (5-minute) input tokens (~1.25x input by default). */
  cacheWritePerMTok: number;
}

/** Cache-read is 10% of the input rate unless a model overrides it. */
export const CACHE_READ_MULTIPLIER = 0.1;
/** Cache-write (5m TTL) is 125% of the input rate unless a model overrides it. */
export const CACHE_WRITE_MULTIPLIER = 1.25;

function withCacheRates(
  input: number,
  output: number,
  overrides: Partial<Pick<ModelPricing, "cacheReadPerMTok" | "cacheWritePerMTok">> = {},
): ModelPricing {
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: overrides.cacheReadPerMTok ?? input * CACHE_READ_MULTIPLIER,
    cacheWritePerMTok: overrides.cacheWritePerMTok ?? input * CACHE_WRITE_MULTIPLIER,
  };
}

/**
 * Built-in pricing, keyed by the exact Anthropic model string. Prices are the
 * Anthropic first-party API rates as of 2026-09.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-5": withCacheRates(5, 25),
  "claude-opus-4-8": withCacheRates(5, 25),
  "claude-opus-4-7": withCacheRates(5, 25),
  "claude-opus-4-6": withCacheRates(5, 25),
  "claude-opus-4-5": withCacheRates(5, 25),
  "claude-sonnet-5": withCacheRates(2, 10),
  "claude-sonnet-4-6": withCacheRates(3, 15),
  "claude-sonnet-4-5": withCacheRates(3, 15),
  "claude-haiku-4-5": withCacheRates(1, 5),
  "claude-fable-5": withCacheRates(10, 50),
  "claude-fable-5-1": withCacheRates(10, 50),
};

/**
 * The rate used when a model has no entry and no override — the current default
 * chat model's tier, so an unknown model is costed conservatively rather than
 * as free.
 */
export const FALLBACK_MODEL_PRICING: ModelPricing = withCacheRates(3, 15);

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Parse `AI_PRICING_OVERRIDES_JSON` defensively — a bad value is ignored. */
export function parsePricingOverrides(
  raw: string | undefined,
): Record<string, Partial<ModelPricing>> {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, Partial<ModelPricing>> = {};
  for (const [model, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as Record<string, unknown>;
    const partial: Partial<ModelPricing> = {};
    if (isFiniteNonNegative(v.inputPerMTok)) partial.inputPerMTok = v.inputPerMTok;
    if (isFiniteNonNegative(v.outputPerMTok)) partial.outputPerMTok = v.outputPerMTok;
    if (isFiniteNonNegative(v.cacheReadPerMTok)) partial.cacheReadPerMTok = v.cacheReadPerMTok;
    if (isFiniteNonNegative(v.cacheWritePerMTok)) partial.cacheWritePerMTok = v.cacheWritePerMTok;
    if (Object.keys(partial).length > 0) out[model] = partial;
  }
  return out;
}

let cachedEnvOverrides: Record<string, Partial<ModelPricing>> | null = null;
let cachedEnvRaw: string | undefined;

function envOverrides(): Record<string, Partial<ModelPricing>> {
  const raw = process.env.AI_PRICING_OVERRIDES_JSON;
  if (raw !== cachedEnvRaw) {
    cachedEnvRaw = raw;
    cachedEnvOverrides = parsePricingOverrides(raw);
  }
  return cachedEnvOverrides ?? {};
}

/**
 * Resolve the effective pricing for a model: built-in defaults, then the env
 * override, then an explicit `extraOverrides` map (e.g. a billing plan). Any
 * partially-specified layer is merged; a model with no data anywhere falls back
 * to {@link FALLBACK_MODEL_PRICING}.
 */
export function resolveModelPricing(
  model: string,
  extraOverrides?: Record<string, Partial<ModelPricing>>,
): ModelPricing {
  const base = MODEL_PRICING[model] ?? FALLBACK_MODEL_PRICING;
  const merged: ModelPricing = { ...base };

  const env = envOverrides()[model];
  const extra = extraOverrides?.[model];
  for (const layer of [env, extra]) {
    if (!layer) continue;
    if (layer.inputPerMTok !== undefined) merged.inputPerMTok = layer.inputPerMTok;
    if (layer.outputPerMTok !== undefined) merged.outputPerMTok = layer.outputPerMTok;
    if (layer.cacheReadPerMTok !== undefined) merged.cacheReadPerMTok = layer.cacheReadPerMTok;
    if (layer.cacheWritePerMTok !== undefined) merged.cacheWritePerMTok = layer.cacheWritePerMTok;
  }

  // If only input/output were overridden, keep cache rates proportional to the
  // (possibly new) input rate unless they were themselves overridden.
  if (!MODEL_PRICING[model] && !env?.cacheReadPerMTok && !extra?.cacheReadPerMTok) {
    merged.cacheReadPerMTok = merged.inputPerMTok * CACHE_READ_MULTIPLIER;
  }
  if (!MODEL_PRICING[model] && !env?.cacheWritePerMTok && !extra?.cacheWritePerMTok) {
    merged.cacheWritePerMTok = merged.inputPerMTok * CACHE_WRITE_MULTIPLIER;
  }
  return merged;
}

/** True when the model has explicit pricing (built-in or overridden). */
export function hasKnownPricing(model: string): boolean {
  return model in MODEL_PRICING || model in envOverrides();
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

const PER_MTOK = 1_000_000;

/** Round to 8 decimal places (matches the `numeric(14,8)` column). */
export function roundCost(usd: number): number {
  return Math.round(usd * 1e8) / 1e8;
}

/**
 * Estimated USD cost for one Anthropic call. Pure — deterministic for a given
 * model, token counts and pricing config.
 */
export function estimateCostUsd(
  input: { model: string } & TokenUsage,
  extraOverrides?: Record<string, Partial<ModelPricing>>,
): number {
  const p = resolveModelPricing(input.model, extraOverrides);
  const nn = (v: number | undefined) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

  const cost =
    (nn(input.inputTokens) * p.inputPerMTok +
      nn(input.outputTokens) * p.outputPerMTok +
      nn(input.cacheReadInputTokens) * p.cacheReadPerMTok +
      nn(input.cacheCreationInputTokens) * p.cacheWritePerMTok) /
    PER_MTOK;

  return roundCost(cost);
}
