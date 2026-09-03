import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_LEAD, type LeadData } from "../types/chat.ts";
import {
  calculateLeadScore,
  classifyTimeline,
  maxScore,
  scoreWeights,
} from "./lead-scoring.ts";
import { realEstateTemplate } from "./config/templates/real-estate.ts";
import { clinicTemplate } from "./config/templates/clinic.ts";

const RE_SCORING = realEstateTemplate.scoring;

/** Build a real-estate lead: core fields on top, the rest in customData. */
function reLead(fields: {
  name?: string | null;
  intent?: string | null;
  location?: unknown;
  budget?: unknown;
  property_type?: unknown;
  bedrooms?: unknown;
  financing?: unknown;
  timeline?: unknown;
}): LeadData {
  const { name = null, intent = null, ...custom } = fields;
  return { ...EMPTY_LEAD, name, intent, customData: { ...custom } };
}

const score = (l: LeadData) => calculateLeadScore(l, RE_SCORING);

test("spec example scores 100 / HOT", () => {
  const result = score(
    reLead({
      name: "محمد",
      intent: "buy",
      location: "بريدة",
      budget: 1_000_000,
      property_type: "apartment",
      bedrooms: 4,
      financing: true,
      timeline: "1 week",
    }),
  );
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
  const result = score(reLead({}));
  assert.equal(result.score, 0);
  assert.equal(result.temperature, "COLD");
  assert.deepEqual(Object.values(result.breakdown), [0, 0, 0, 0, 0, 0, 0]);
});

test("partial lead is scored only from known fields", () => {
  const result = score(
    reLead({
      name: "Ahmed",
      intent: "buy",
      location: "Riyadh",
      property_type: "apartment",
    }),
  );
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
    reLead({
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
  const result = score(
    reLead({ intent: "rent", budget: 120_000, timeline: "end of year" }),
  );
  assert.equal(result.score, 20);
  assert.equal(result.temperature, "COLD");
});

test("changing one field only moves its own category", () => {
  const base = reLead({
    intent: "buy",
    budget: 500_000,
    location: "Riyadh",
    property_type: "villa",
    bedrooms: 3,
    financing: true,
    timeline: "2 months",
  });
  const baseResult = score(base);
  const changed = score({
    ...base,
    customData: { ...base.customData, budget: 1_000_000 },
  });

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

test("scoring reads custom fields, not just top-level lead props", () => {
  const inCustom = score(
    reLead({ budget: 1_000_000, timeline: "1 week" }),
  );
  assert.equal(inCustom.breakdown.budget, 20);
  assert.equal(inCustom.breakdown.timeline, 20);
});

test("invalid / malformed values never throw and score 0", () => {
  const garbage = {
    ...EMPTY_LEAD,
    name: 123,
    intent: "maybe",
    customData: {
      location: "",
      budget: "1000000",
      property_type: "   ",
      bedrooms: Number.NaN,
      financing: "yes",
      timeline: 42,
    },
  } as unknown as LeadData;

  const result = score(garbage);
  assert.equal(result.score, 0);
  assert.equal(result.temperature, "COLD");

  assert.doesNotThrow(() =>
    calculateLeadScore(null as unknown as LeadData, RE_SCORING),
  );
  assert.doesNotThrow(() =>
    calculateLeadScore(undefined as unknown as LeadData, RE_SCORING),
  );
  assert.doesNotThrow(() =>
    calculateLeadScore(EMPTY_LEAD, {} as typeof RE_SCORING),
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

test("real estate & clinic scoring weights each sum to 100", () => {
  assert.equal(maxScore(RE_SCORING), 100);
  assert.equal(maxScore(clinicTemplate.scoring), 100);
  const total = Object.values(scoreWeights(RE_SCORING)).reduce(
    (a, b) => a + b,
    0,
  );
  assert.equal(total, 100);
});

test("clinic lead scores through the same engine", () => {
  const clinicLead: LeadData = {
    ...EMPTY_LEAD,
    name: "Ahmed",
    phone: "0555555555",
    customData: {
      service: "Dental Cleaning",
      doctor: "Dr. Ahmed",
      appointment_date: "2026-09-10",
      insurance: true,
      urgency: "high",
    },
  };
  const result = calculateLeadScore(clinicLead, clinicTemplate.scoring);
  // service 20 + doctor 15 + appointment_date 25 + insurance 15 + urgency 25
  assert.equal(result.score, 100);
  assert.equal(result.temperature, "HOT");
  assert.deepEqual(result.breakdown, {
    service: 20,
    doctor: 15,
    appointment_date: 25,
    insurance: 15,
    urgency: 25,
  });
});

test("clinic scoring never references real-estate fields", () => {
  const keys = clinicTemplate.scoring.rules.map((r) => r.fieldKey);
  for (const forbidden of [
    "budget",
    "bedrooms",
    "property_type",
    "financing",
    "location",
    "timeline",
  ]) {
    assert.ok(!keys.includes(forbidden), `clinic scores "${forbidden}"`);
  }
});
