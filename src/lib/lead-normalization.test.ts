import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleLead,
  normalizeFieldValue,
  parseBooleanish,
  parseNumeric,
} from "./lead-normalization.ts";
import { getEffectiveConfig } from "./config/index.ts";
import type { LeadFieldDefinition } from "./config/types.ts";

const field = (
  over: Partial<LeadFieldDefinition> & Pick<LeadFieldDefinition, "type">,
): LeadFieldDefinition => ({
  key: "f",
  label: "F",
  required: false,
  enabled: true,
  order: 1,
  ...over,
});

const RE = getEffectiveConfig();
const CLINIC = getEffectiveConfig({
  organizationId: "t",
  industryTemplateId: "clinic",
});

// ── parseNumeric ──────────────────────────────────────────────────────────

test("parseNumeric handles words, separators and Arabic digits", () => {
  assert.equal(parseNumeric(1_000_000), 1_000_000);
  assert.equal(parseNumeric("1000000"), 1_000_000);
  assert.equal(parseNumeric("1,000,000"), 1_000_000);
  assert.equal(parseNumeric("1 million"), 1_000_000);
  assert.equal(parseNumeric("1.2m"), 1_200_000);
  assert.equal(parseNumeric("800k"), 800_000);
  assert.equal(parseNumeric("مليون"), null); // no digits
  assert.equal(parseNumeric("١٠٠٠٠٠٠"), 1_000_000);
  assert.equal(parseNumeric("٤"), 4);
  assert.equal(parseNumeric("3 bedrooms"), 3);
  assert.equal(parseNumeric(""), null);
  assert.equal(parseNumeric(null), null);
  assert.equal(parseNumeric({}), null);
  assert.equal(parseNumeric(Number.NaN), null);
});

// ── parseBooleanish ───────────────────────────────────────────────────────

test("parseBooleanish handles yes/no words, Arabic and numbers", () => {
  assert.equal(parseBooleanish(true), true);
  assert.equal(parseBooleanish("yes"), true);
  assert.equal(parseBooleanish("Yes"), true);
  assert.equal(parseBooleanish("نعم"), true);
  assert.equal(parseBooleanish("true"), true);
  assert.equal(parseBooleanish(1), true);
  assert.equal(parseBooleanish(false), false);
  assert.equal(parseBooleanish("no"), false);
  assert.equal(parseBooleanish("لا"), false);
  assert.equal(parseBooleanish(0), false);
  assert.equal(parseBooleanish("maybe"), null);
  assert.equal(parseBooleanish(null), null);
  assert.equal(parseBooleanish(42), null);
});

// ── normalizeFieldValue per type ──────────────────────────────────────────

test("normalizeFieldValue: number", () => {
  assert.equal(normalizeFieldValue("1 million", field({ type: "number" })), 1_000_000);
  assert.equal(normalizeFieldValue("4.6", field({ type: "number" })), 5);
  assert.equal(normalizeFieldValue(null, field({ type: "number" })), null);
  assert.equal(normalizeFieldValue("abc", field({ type: "number" })), null);
});

test("normalizeFieldValue: boolean", () => {
  assert.equal(normalizeFieldValue("نعم", field({ type: "boolean" })), true);
  assert.equal(normalizeFieldValue("cash", field({ type: "boolean" })), null);
  assert.equal(normalizeFieldValue(undefined, field({ type: "boolean" })), null);
});

test("normalizeFieldValue: text preserves case and trims", () => {
  assert.equal(
    normalizeFieldValue("  North Riyadh  ", field({ type: "text" })),
    "North Riyadh",
  );
  assert.equal(normalizeFieldValue("   ", field({ type: "text" })), null);
  assert.equal(normalizeFieldValue(123, field({ type: "text" })), "123");
});

test("normalizeFieldValue: date kept as trimmed string", () => {
  assert.equal(
    normalizeFieldValue("2026-09-10", field({ type: "date" })),
    "2026-09-10",
  );
  assert.equal(normalizeFieldValue("tomorrow", field({ type: "date" })), "tomorrow");
  assert.equal(normalizeFieldValue(null, field({ type: "date" })), null);
});

test("normalizeFieldValue: select matches value / label / alias, else lowercases", () => {
  const intent = field({
    type: "select",
    options: [
      { value: "buy", label: "Buy", aliases: ["purchase"] },
      { value: "rent", label: "Rent" },
    ],
  });
  assert.equal(normalizeFieldValue("buy", intent), "buy");
  assert.equal(normalizeFieldValue("Buy", intent), "buy");
  assert.equal(normalizeFieldValue("PURCHASE", intent), "buy");
  assert.equal(normalizeFieldValue("Rent", intent), "rent");
  assert.equal(normalizeFieldValue("maybe", intent), "maybe");
  assert.equal(normalizeFieldValue(null, intent), null);
});

test("normalizeFieldValue never throws on wild input", () => {
  for (const bad of [[], {}, () => 0, Symbol("x"), Infinity, -Infinity]) {
    assert.doesNotThrow(() =>
      normalizeFieldValue(bad, field({ type: "number" })),
    );
    assert.doesNotThrow(() => normalizeFieldValue(bad, field({ type: "text" })));
  }
});

// ── assembleLead: real estate regression ──────────────────────────────────

test("assembleLead reproduces the real-estate example shape", () => {
  const raw = {
    name: "محمد",
    intent: "buy",
    location: "Riyadh",
    budget: "1,000,000",
    property_type: "Apartment",
    bedrooms: "4",
    financing: "yes",
    timeline: "1 week",
  };
  const lead = assembleLead(raw, RE);
  assert.deepEqual(lead, {
    name: "محمد",
    phone: null,
    email: null,
    intent: "buy",
    customData: {
      location: "Riyadh",
      budget: 1_000_000,
      property_type: "apartment",
      bedrooms: 4,
      financing: true,
      timeline: "1 week",
    },
  });
});

test("assembleLead: missing fields become null, no real-estate keys for a bare object", () => {
  const lead = assembleLead({}, RE);
  assert.equal(lead.name, null);
  assert.equal(lead.intent, null);
  assert.deepEqual(lead.customData, {
    location: null,
    budget: null,
    property_type: null,
    bedrooms: null,
    financing: null,
    timeline: null,
  });
});

test("assembleLead tolerates malformed input", () => {
  assert.doesNotThrow(() => assembleLead(null, RE));
  assert.doesNotThrow(() => assembleLead("nope", RE));
  assert.doesNotThrow(() => assembleLead(42, RE));
  const lead = assembleLead({ budget: {}, bedrooms: [], financing: "??" }, RE);
  assert.equal(lead.customData.budget, null);
  assert.equal(lead.customData.bedrooms, null);
  assert.equal(lead.customData.financing, null);
});

// ── assembleLead: clinic through the same function ─────────────────────────

test("assembleLead builds a clinic lead with clinic-only custom fields", () => {
  const raw = {
    name: "Ahmed",
    phone: "+966555555555",
    service: "Dental Cleaning",
    doctor: "Dr. Ahmed",
    appointment_date: "2026-09-10",
    insurance: "yes",
    urgency: "urgent",
  };
  const lead = assembleLead(raw, CLINIC);
  assert.equal(lead.name, "Ahmed");
  assert.equal(lead.phone, "+966555555555");
  assert.equal(lead.intent, null);
  assert.deepEqual(lead.customData, {
    service: "Dental Cleaning",
    doctor: "Dr. Ahmed",
    appointment_date: "2026-09-10",
    insurance: true,
    urgency: "high", // "urgent" is an alias of "high"
  });
  for (const reKey of ["budget", "bedrooms", "property_type", "financing"]) {
    assert.ok(!(reKey in lead.customData));
  }
});
