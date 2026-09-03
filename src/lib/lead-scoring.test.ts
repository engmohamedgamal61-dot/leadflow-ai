import { test } from "node:test";
import assert from "node:assert/strict";
import type { LeadData } from "@/types/chat";
import {
  calculateLeadScore,
  classifyTimeline,
  maxScore,
  scoreWeights,
} from "./lead-scoring.ts";
import { realEstateTemplate } from "./config/templates/real-estate.ts";

const SCORING = realEstateTemplate.scoring;

const EMPTY: LeadData = {
  name: null,
  intent: null,
  location: null,
  budget: null,
  property_type: null,
  bedrooms: null,
  financing: null,
  timeline: null,
};

const lead = (over: Partial<LeadData>): LeadData => ({ ...EMPTY, ...over });
const score = (l: LeadData) => calculateLeadScore(l, SCORING);

test("spec example scores 100 / HOT", () => {
  const result = score({
    name: "محمد",
    intent: "buy",
    location: "بريدة",
    budget: 1_000_000,
    property_type: "apartment",
    bedrooms: 4,
    financing: true,
    timeline: "1 week",
  });
  assert.equal(result.score, 100);
  assert.equal(result.temperature, "HOT");
  assert.deepEqual(result.breakdown, {
    intent: 15,
    budget: 20,
    location: 10,
    property_type: 10,
    bedrooms: 10,
    financing: 15,
    timeline: 20,
  });
});

test("completely empty lead scores 0 / COLD", () => {
  const result = score(EMPTY);
  assert.equal(result.score, 0);
  assert.equal(result.temperature, "COLD");
  assert.deepEqual(Object.values(result.breakdown), [0, 0, 0, 0, 0, 0, 0]);
});

test("partial lead is scored only from known fields", () => {
  const result = score({
    name: "Ahmed",
    intent: "buy",
    location: "Riyadh",
    budget: null,
    property_type: "apartment",
    bedrooms: null,
    financing: null,
    timeline: null,
  });
  // intent 15 + location 10 + property_type 10 = 35
  assert.equal(result.score, 35);
  assert.equal(result.temperature, "COLD");
  assert.deepEqual(result.breakdown, {
    intent: 15,
    budget: 0,
    location: 10,
    property_type: 10,
    bedrooms: 0,
    financing: 0,
    timeline: 0,
  });
});

test("realistic WARM lead", () => {
  // rent 10 + budget≥500k 15 + location 10 + property_type 10 + bedrooms 10
  // + financing false 10 + timeline 3 months 10  = 75
  const result = score(
    lead({
      intent: "rent",
      budget: 600_000,
      location: "Jeddah",
      property_type: "apartment",
      bedrooms: 2,
      financing: false,
      timeline: "3 months",
    }),
  );
  assert.equal(result.score, 75);
  assert.equal(result.temperature, "WARM");
});

test("realistic COLD lead", () => {
  // rent 10 + budget<250k 5 + timeline over 3 months 5 = 20
  const result = score(
    lead({ intent: "rent", budget: 120_000, timeline: "end of year" }),
  );
  assert.equal(result.score, 20);
  assert.equal(result.temperature, "COLD");
});

test("changing one field only moves its own category", () => {
  const base = lead({
    intent: "buy",
    budget: 500_000,
    location: "Riyadh",
    property_type: "villa",
    bedrooms: 3,
    financing: true,
    timeline: "2 months",
  });
  const baseResult = score(base);
  const changed = score({ ...base, budget: 1_000_000 });

  assert.equal(changed.breakdown.budget, 20);
  assert.equal(baseResult.breakdown.budget, 15);
  for (const key of Object.keys(baseResult.breakdown)) {
    if (key === "budget") continue;
    assert.equal(
      changed.breakdown[key],
      baseResult.breakdown[key],
      `${key} should not change`,
    );
  }
  assert.equal(changed.score - baseResult.score, 5);
});

test("invalid / malformed values never throw and score 0", () => {
  const garbage = {
    name: 123,
    intent: "maybe",
    location: "",
    budget: "1000000",
    property_type: "   ",
    bedrooms: Number.NaN,
    financing: "yes",
    timeline: 42,
  } as unknown as LeadData;

  const result = score(garbage);
  assert.equal(result.score, 0);
  assert.equal(result.temperature, "COLD");

  assert.doesNotThrow(() =>
    calculateLeadScore(null as unknown as LeadData, SCORING),
  );
  assert.doesNotThrow(() =>
    calculateLeadScore(undefined as unknown as LeadData, SCORING),
  );
  // Malformed scoring config must not throw either.
  assert.doesNotThrow(() =>
    calculateLeadScore(EMPTY, {} as typeof SCORING),
  );
});

test("timeline classification buckets", () => {
  assert.equal(classifyTimeline("1 week"), "within_1_week");
  assert.equal(classifyTimeline("ASAP"), "within_1_week");
  assert.equal(classifyTimeline("2 weeks"), "within_1_month");
  assert.equal(classifyTimeline("1 month"), "within_1_month");
  assert.equal(classifyTimeline("3 months"), "within_3_months");
  assert.equal(classifyTimeline("6 months"), "over_3_months");
  assert.equal(classifyTimeline("next year"), "over_3_months");
  assert.equal(classifyTimeline("flexible"), "over_3_months");
  assert.equal(classifyTimeline(null), "unknown");
  assert.equal(classifyTimeline(""), "unknown");
  assert.equal(classifyTimeline("سيب"), "unknown");
});

test("real estate scoring weights sum to 100", () => {
  assert.equal(maxScore(SCORING), 100);
  const total = Object.values(scoreWeights(SCORING)).reduce((a, b) => a + b, 0);
  assert.equal(total, 100);
});
