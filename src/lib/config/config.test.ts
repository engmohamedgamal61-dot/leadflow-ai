import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INDUSTRY_SLUG,
  getEffectiveConfig,
  getIndustryTemplate,
  listIndustryTemplates,
  resolveEffectiveConfig,
  validateEffectiveConfig,
  validateIndustryTemplate,
} from "./index.ts";
import { realEstateTemplate } from "./templates/real-estate.ts";
import { clinicTemplate } from "./templates/clinic.ts";
import type { IndustryTemplate, OrganizationConfig } from "./types.ts";

const EXPECTED_REAL_ESTATE_FIELDS = [
  "name",
  "intent",
  "location",
  "budget",
  "property_type",
  "bedrooms",
  "financing",
  "timeline",
];

const EXPECTED_CLINIC_FIELDS = [
  "name",
  "phone",
  "service",
  "doctor",
  "appointment_date",
  "insurance",
  "urgency",
];

const REAL_ESTATE_ONLY = [
  "budget",
  "bedrooms",
  "property_type",
  "financing",
  "location",
  "timeline",
];
const CLINIC_ONLY = [
  "service",
  "doctor",
  "appointment_date",
  "insurance",
  "urgency",
];

test("real estate template exists and is the default", () => {
  assert.equal(DEFAULT_INDUSTRY_SLUG, "real-estate");
  assert.ok(getIndustryTemplate("real-estate"));
  assert.equal(getIndustryTemplate("real-estate")?.name, "Real Estate");
  assert.ok(
    listIndustryTemplates().some((t) => t.slug === "real-estate"),
  );
});

test("unknown template slug returns undefined", () => {
  assert.equal(getIndustryTemplate("does-not-exist"), undefined);
});

test("real estate template contains exactly the expected fields", () => {
  const keys = realEstateTemplate.leadFields.map((f) => f.key);
  assert.deepEqual([...keys].sort(), [...EXPECTED_REAL_ESTATE_FIELDS].sort());
  for (const field of realEstateTemplate.leadFields) {
    assert.equal(typeof field.label, "string");
    assert.ok(
      ["text", "number", "boolean", "select", "date"].includes(field.type),
    );
    assert.equal(typeof field.order, "number");
  }
});

test("qualification flow only references real field keys, in order", () => {
  const fieldKeys = new Set(realEstateTemplate.leadFields.map((f) => f.key));
  const orders = realEstateTemplate.qualificationFlow.map((s) => s.order);
  for (const step of realEstateTemplate.qualificationFlow) {
    assert.ok(
      fieldKeys.has(step.fieldKey),
      `flow references unknown field "${step.fieldKey}"`,
    );
  }
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test("real estate template passes validation", () => {
  const result = validateIndustryTemplate(realEstateTemplate);
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("template scoring config is valid and every rule targets a field", () => {
  const fieldKeys = new Set(realEstateTemplate.leadFields.map((f) => f.key));
  const { rules, thresholds } = realEstateTemplate.scoring;
  assert.ok(rules.length > 0);
  let max = 0;
  for (const rule of rules) {
    assert.ok(fieldKeys.has(rule.fieldKey));
    assert.ok(rule.maxPoints > 0);
    max += rule.maxPoints;
  }
  assert.equal(max, 100);
  assert.ok(thresholds.hot >= thresholds.warm);
});

test("validation catches a broken template without throwing", () => {
  const broken = {
    ...realEstateTemplate,
    qualificationFlow: [
      { fieldKey: "not_a_field", order: 1, required: true },
    ],
    scoring: {
      rules: [
        {
          kind: "presence" as const,
          fieldKey: "ghost",
          maxPoints: 10,
          points: 10,
          whenMissing: 0,
        },
      ],
      thresholds: { hot: 10, warm: 50 }, // hot < warm
    },
  } as IndustryTemplate;

  const result = validateIndustryTemplate(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("not_a_field")));
  assert.ok(result.errors.some((e) => e.includes("ghost")));
  assert.ok(result.errors.some((e) => e.includes("hot >= warm")));
});

test("malformed input does not crash validation", () => {
  for (const bad of [null, undefined, {}, 42, "template", []]) {
    assert.doesNotThrow(() =>
      validateIndustryTemplate(bad as unknown as IndustryTemplate),
    );
    assert.equal(
      validateIndustryTemplate(bad as unknown as IndustryTemplate).valid,
      false,
    );
  }
});

test("effective config with no override equals the template defaults", () => {
  const effective = getEffectiveConfig();
  assert.equal(effective.templateSlug, "real-estate");
  assert.equal(effective.organizationId, null);
  assert.deepEqual(
    effective.leadFields.map((f) => f.key),
    realEstateTemplate.leadFields.map((f) => f.key),
  );
  assert.deepEqual(effective.scoring, realEstateTemplate.scoring);
  assert.equal(validateEffectiveConfig(effective).valid, true);
});

test("organization overrides modify template defaults", () => {
  const org: OrganizationConfig = {
    organizationId: "org_123",
    industryTemplateId: "real-estate",
    fieldOverrides: [
      { key: "bedrooms", enabled: false },
      { key: "budget", label: "Investment budget", required: false },
    ],
    qualificationOverrides: [
      { fieldKey: "name", order: 5 },
      { fieldKey: "financing", enabled: false },
    ],
    scoringOverrides: {
      thresholds: { hot: 90 },
      rules: [
        {
          kind: "match",
          fieldKey: "intent",
          maxPoints: 20,
          cases: { buy: 20, rent: 5 },
          whenMissing: 0,
        },
      ],
    },
    aiBehaviorOverrides: {
      tone: "formal and brief",
      additionalRules: ["Never discuss commission."],
    },
  };

  const effective = resolveEffectiveConfig(realEstateTemplate, org);

  // field override
  const bedrooms = effective.leadFields.find((f) => f.key === "bedrooms");
  assert.equal(bedrooms?.enabled, false);
  assert.equal(
    effective.leadFields.find((f) => f.key === "budget")?.label,
    "Investment budget",
  );

  // qualification override: name moved to front, financing + bedrooms dropped
  assert.equal(effective.qualificationFlow[0]?.fieldKey, "name");
  assert.ok(
    !effective.qualificationFlow.some((s) => s.fieldKey === "financing"),
  );
  assert.ok(
    !effective.qualificationFlow.some((s) => s.fieldKey === "bedrooms"),
  );

  // scoring override: threshold + replaced intent rule
  assert.equal(effective.scoring.thresholds.hot, 90);
  assert.equal(effective.scoring.thresholds.warm, 50); // untouched
  const intentRule = effective.scoring.rules.find(
    (r) => r.fieldKey === "intent",
  );
  assert.equal(intentRule?.maxPoints, 20);

  // ai behavior override: tone replaced, extra rule appended
  assert.equal(effective.aiBehavior.tone, "formal and brief");
  assert.ok(
    effective.aiBehavior.rules.includes("Never discuss commission."),
  );
  assert.ok(effective.aiBehavior.rules.length > realEstateTemplate.aiBehavior.rules.length);
});

test("resolveEffectiveConfig tolerates a null / empty override", () => {
  assert.doesNotThrow(() => resolveEffectiveConfig(realEstateTemplate, null));
  const effective = resolveEffectiveConfig(realEstateTemplate, {
    organizationId: "org_x",
    industryTemplateId: "real-estate",
  });
  assert.deepEqual(
    effective.leadFields.map((f) => f.key),
    realEstateTemplate.leadFields.map((f) => f.key),
  );
});

test("getEffectiveConfig falls back to default for an unknown template id", () => {
  const effective = getEffectiveConfig({
    organizationId: "org_y",
    industryTemplateId: "totally-unknown-industry",
  });
  assert.equal(effective.templateSlug, "real-estate");
});

// ── Clinic ────────────────────────────────────────────────────────────────

test("clinic template is registered and resolvable via the same API", () => {
  assert.ok(getIndustryTemplate("clinic"));
  assert.equal(getIndustryTemplate("clinic")?.name, "Clinic");
  assert.ok(listIndustryTemplates().some((t) => t.slug === "clinic"));

  const effective = getEffectiveConfig({
    organizationId: "org_clinic",
    industryTemplateId: "clinic",
  });
  assert.equal(effective.templateSlug, "clinic");
});

test("clinic template contains exactly the expected fields and passes validation", () => {
  const keys = clinicTemplate.leadFields.map((f) => f.key);
  assert.deepEqual([...keys].sort(), [...EXPECTED_CLINIC_FIELDS].sort());
  assert.equal(validateIndustryTemplate(clinicTemplate).valid, true,
    validateIndustryTemplate(clinicTemplate).errors.join("; "));
});

test("clinic qualification flow references only clinic field keys, in order", () => {
  const fieldKeys = new Set(clinicTemplate.leadFields.map((f) => f.key));
  const orders = clinicTemplate.qualificationFlow.map((s) => s.order);
  for (const step of clinicTemplate.qualificationFlow) {
    assert.ok(fieldKeys.has(step.fieldKey));
  }
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test("clinic scoring config is valid and sums to 100", () => {
  const fieldKeys = new Set(clinicTemplate.leadFields.map((f) => f.key));
  let max = 0;
  for (const rule of clinicTemplate.scoring.rules) {
    assert.ok(fieldKeys.has(rule.fieldKey));
    assert.ok(rule.maxPoints > 0);
    max += rule.maxPoints;
  }
  assert.equal(max, 100);
  const effective = getEffectiveConfig({
    organizationId: "o",
    industryTemplateId: "clinic",
  });
  assert.equal(validateEffectiveConfig(effective).valid, true);
});

test("clinic AI behaviour is intake-only (no diagnosis)", () => {
  const rules = clinicTemplate.aiBehavior.rules.join(" ").toLowerCase();
  assert.ok(rules.includes("never diagnose"));
  assert.ok(rules.includes("never give medical advice"));
  assert.ok(rules.includes("emergency"));
});

// ── Cross-industry isolation ──────────────────────────────────────────────

test("clinic config does not contain real-estate fields unless configured", () => {
  const clinicKeys = new Set(clinicTemplate.leadFields.map((f) => f.key));
  for (const key of REAL_ESTATE_ONLY) {
    assert.ok(!clinicKeys.has(key), `clinic unexpectedly has "${key}"`);
  }
  const scoringKeys = clinicTemplate.scoring.rules.map((r) => r.fieldKey);
  for (const key of REAL_ESTATE_ONLY) {
    assert.ok(!scoringKeys.includes(key));
  }
});

test("real estate config does not contain clinic fields unless configured", () => {
  const reKeys = new Set(realEstateTemplate.leadFields.map((f) => f.key));
  for (const key of CLINIC_ONLY) {
    assert.ok(!reKeys.has(key), `real estate unexpectedly has "${key}"`);
  }
  const scoringKeys = realEstateTemplate.scoring.rules.map((r) => r.fieldKey);
  for (const key of CLINIC_ONLY) {
    assert.ok(!scoringKeys.includes(key));
  }
});

test("the two templates share no industry-specific field keys", () => {
  const reCustom = realEstateTemplate.leadFields
    .map((f) => f.key)
    .filter((k) => !["name", "phone", "email", "intent"].includes(k));
  const clinicCustom = clinicTemplate.leadFields
    .map((f) => f.key)
    .filter((k) => !["name", "phone", "email", "intent"].includes(k));
  assert.ok(reCustom.every((k) => !clinicCustom.includes(k)));
});
