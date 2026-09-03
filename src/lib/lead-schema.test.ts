import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExtractionSystemPrompt, buildLeadSchema } from "./lead-schema.ts";
import { getEffectiveConfig } from "./config/index.ts";

const RE = getEffectiveConfig();
const CLINIC = getEffectiveConfig({
  organizationId: "t",
  industryTemplateId: "clinic",
});

function schemaFor(config: ReturnType<typeof getEffectiveConfig>) {
  return buildLeadSchema(config.leadFields.filter((f) => f.enabled)) as {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, { type: [string, string]; description: string }>;
  };
}

test("real-estate schema is generated from the configured fields", () => {
  const schema = schemaFor(RE);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [
      "name",
      "intent",
      "location",
      "budget",
      "property_type",
      "bedrooms",
      "financing",
      "timeline",
    ].sort(),
  );
  assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());
  // types come from the field definitions, every field nullable
  assert.deepEqual(schema.properties.budget.type, ["number", "null"]);
  assert.deepEqual(schema.properties.bedrooms.type, ["number", "null"]);
  assert.deepEqual(schema.properties.financing.type, ["boolean", "null"]);
  assert.deepEqual(schema.properties.location.type, ["string", "null"]);
  assert.deepEqual(schema.properties.intent.type, ["string", "null"]);
});

test("clinic schema is generated from the configured fields", () => {
  const schema = schemaFor(CLINIC);
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [
      "name",
      "phone",
      "service",
      "doctor",
      "appointment_date",
      "insurance",
      "urgency",
    ].sort(),
  );
  assert.deepEqual(schema.properties.insurance.type, ["boolean", "null"]);
  assert.deepEqual(schema.properties.appointment_date.type, ["string", "null"]);
});

test("no real-estate fields leak into the clinic schema", () => {
  const clinicProps = Object.keys(schemaFor(CLINIC).properties);
  for (const key of ["budget", "bedrooms", "property_type", "financing", "location", "timeline"]) {
    assert.ok(!clinicProps.includes(key), `clinic schema has "${key}"`);
  }
});

test("no clinic fields leak into the real-estate schema", () => {
  const reProps = Object.keys(schemaFor(RE).properties);
  for (const key of ["service", "doctor", "appointment_date", "insurance", "urgency"]) {
    assert.ok(!reProps.includes(key), `real-estate schema has "${key}"`);
  }
});

test("extraction system prompt is generic and lists the config languages", () => {
  const prompt = buildExtractionSystemPrompt(CLINIC);
  assert.ok(prompt.includes("NEVER invent"));
  assert.ok(prompt.includes("Arabic"));
  assert.ok(!/real[- ]estate|property|clinic|doctor/i.test(prompt));
});
