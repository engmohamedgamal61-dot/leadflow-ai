import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateCostUsd,
  MODEL_PRICING,
  parsePricingOverrides,
  resolveModelPricing,
  hasKnownPricing,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
} from "./pricing.ts";

test("built-in pricing matches Anthropic list rates", () => {
  assert.equal(MODEL_PRICING["claude-sonnet-5"].inputPerMTok, 2);
  assert.equal(MODEL_PRICING["claude-sonnet-5"].outputPerMTok, 10);
  assert.equal(MODEL_PRICING["claude-opus-5"].inputPerMTok, 5);
  assert.equal(MODEL_PRICING["claude-opus-5"].outputPerMTok, 25);
  assert.equal(MODEL_PRICING["claude-haiku-4-5"].inputPerMTok, 1);
});

test("cache rates default to the input-rate multipliers", () => {
  const p = MODEL_PRICING["claude-sonnet-5"];
  assert.equal(p.cacheReadPerMTok, 2 * CACHE_READ_MULTIPLIER);
  assert.equal(p.cacheWritePerMTok, 2 * CACHE_WRITE_MULTIPLIER);
});

test("estimateCostUsd sums input + output at the model's rates", () => {
  // 1M input @ $2 + 1M output @ $10 = $12 for sonnet-5
  const cost = estimateCostUsd({
    model: "claude-sonnet-5",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(cost, 12);
});

test("estimateCostUsd includes cache read + cache write tokens", () => {
  const cost = estimateCostUsd({
    model: "claude-sonnet-5",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 1_000_000, // $0.20
    cacheCreationInputTokens: 1_000_000, // $2.50
  });
  assert.equal(cost, 2.7);
});

test("estimateCostUsd is small and precise for realistic chat turns", () => {
  const cost = estimateCostUsd({
    model: "claude-sonnet-5",
    inputTokens: 1_500,
    outputTokens: 320,
  });
  // (1500*2 + 320*10) / 1e6 = 0.0062
  assert.equal(cost, 0.0062);
});

test("negative / non-finite token counts are treated as zero", () => {
  const cost = estimateCostUsd({
    model: "claude-sonnet-5",
    inputTokens: -100,
    outputTokens: Number.NaN,
    cacheReadInputTokens: Infinity,
  });
  assert.equal(cost, 0);
});

test("unknown model falls back to a non-zero conservative rate", () => {
  assert.equal(hasKnownPricing("some-future-model"), false);
  const cost = estimateCostUsd({
    model: "some-future-model",
    inputTokens: 1_000_000,
    outputTokens: 0,
  });
  assert.ok(cost > 0, "unknown model should not be costed as free");
});

test("parsePricingOverrides ignores malformed input", () => {
  assert.deepEqual(parsePricingOverrides(undefined), {});
  assert.deepEqual(parsePricingOverrides(""), {});
  assert.deepEqual(parsePricingOverrides("not json"), {});
  assert.deepEqual(parsePricingOverrides("[1,2,3]"), {});
  assert.deepEqual(
    parsePricingOverrides('{"m":{"inputPerMTok":-5}}'),
    {},
    "negative rate rejected",
  );
});

test("parsePricingOverrides keeps valid partial entries", () => {
  const parsed = parsePricingOverrides(
    '{"claude-sonnet-5":{"inputPerMTok":1.5,"outputPerMTok":7}}',
  );
  assert.deepEqual(parsed, {
    "claude-sonnet-5": { inputPerMTok: 1.5, outputPerMTok: 7 },
  });
});

test("resolveModelPricing merges an explicit override map over the defaults", () => {
  const p = resolveModelPricing("claude-sonnet-5", {
    "claude-sonnet-5": { inputPerMTok: 1 },
  });
  assert.equal(p.inputPerMTok, 1);
  assert.equal(p.outputPerMTok, 10, "unspecified fields keep the default");
});

test("estimateCostUsd honours an explicit override map", () => {
  const cost = estimateCostUsd(
    { model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0 },
    { "claude-sonnet-5": { inputPerMTok: 4 } },
  );
  assert.equal(cost, 4);
});

test("AI_PRICING_OVERRIDES_JSON env var overrides at estimate time", () => {
  const original = process.env.AI_PRICING_OVERRIDES_JSON;
  process.env.AI_PRICING_OVERRIDES_JSON = JSON.stringify({
    "claude-sonnet-5": { inputPerMTok: 9, outputPerMTok: 9 },
  });
  try {
    const cost = estimateCostUsd({
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    assert.equal(cost, 9);
  } finally {
    if (original === undefined) delete process.env.AI_PRICING_OVERRIDES_JSON;
    else process.env.AI_PRICING_OVERRIDES_JSON = original;
  }
});
