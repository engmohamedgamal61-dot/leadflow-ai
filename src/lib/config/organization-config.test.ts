import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStoredConfig,
  validateStoredConfig,
  effectiveConfigFromStored,
  diffAiBehavior,
  diffQualification,
  diffScoringThresholds,
  compactStoredConfig,
  type StoredOrgConfig,
} from "./organization-config.ts";
import { realEstateTemplate } from "./templates/real-estate.ts";
import { clinicTemplate } from "./templates/clinic.ts";
import { getEffectiveConfig } from "./index.ts";
import { buildSystemPrompt } from "../chat/system-prompt.ts";
import { calculateLeadScore } from "../lead-scoring.ts";

// ── parse (lenient) ───────────────────────────────────────────────────────

test("parseStoredConfig keeps well-formed overrides, drops garbage", () => {
  const parsed = parseStoredConfig({
    fieldOverrides: [
      { key: "budget", label: "Investment budget", enabled: true, order: 5 },
      { notAKey: true },
      "nonsense",
    ],
    qualificationOverrides: [{ fieldKey: "name", order: 1, questionHint: "their name" }],
    scoringOverrides: { thresholds: { hot: 90, warm: 40 }, junk: 1 },
    aiBehaviorOverrides: { tone: "formal", languages: ["English"], extra: 9 },
  });
  assert.equal(parsed.fieldOverrides?.length, 1);
  assert.equal(parsed.fieldOverrides?.[0].label, "Investment budget");
  assert.equal(parsed.qualificationOverrides?.[0].questionHint, "their name");
  assert.deepEqual(parsed.scoringOverrides?.thresholds, { hot: 90, warm: 40 });
  assert.equal(parsed.aiBehaviorOverrides?.tone, "formal");
  assert.deepEqual(parsed.aiBehaviorOverrides?.languages, ["English"]);
});

test("parseStoredConfig returns {} for a non-object / empty blob", () => {
  assert.deepEqual(parseStoredConfig(null), {});
  assert.deepEqual(parseStoredConfig("x"), {});
  assert.deepEqual(parseStoredConfig({}), {});
  assert.deepEqual(parseStoredConfig({ fieldOverrides: [] }), {});
});

test("parseStoredConfig caps over-long strings", () => {
  const p = parseStoredConfig({
    aiBehaviorOverrides: { persona: "x".repeat(9999) },
  });
  assert.ok((p.aiBehaviorOverrides?.persona?.length ?? 0) <= 400);
});

// ── merge ─────────────────────────────────────────────────────────────────

test("no overrides → EffectiveConfig equals the template defaults (RE + Clinic)", () => {
  for (const tpl of [realEstateTemplate, clinicTemplate]) {
    const eff = effectiveConfigFromStored("org", tpl.slug, {});
    assert.deepEqual(
      eff.leadFields.map((f) => f.key),
      tpl.leadFields.map((f) => f.key),
    );
    assert.deepEqual(eff.scoring, tpl.scoring);
    assert.deepEqual(eff.aiBehavior, tpl.aiBehavior);
    assert.deepEqual(
      eff.qualificationFlow.map((s) => s.fieldKey),
      getEffectiveConfig({ organizationId: "o", industryTemplateId: tpl.slug })
        .qualificationFlow.map((s) => s.fieldKey),
    );
  }
});

test("stored overrides are merged into the EffectiveConfig", () => {
  const stored: StoredOrgConfig = {
    fieldOverrides: [{ key: "bedrooms", enabled: false }],
    qualificationOverrides: [
      { fieldKey: "name", order: 1 },
      { fieldKey: "bedrooms", enabled: false },
    ],
    scoringOverrides: { thresholds: { hot: 70 } },
    aiBehaviorOverrides: { tone: "formal and brief", additionalRules: ["Never quote a price."] },
  };
  const eff = effectiveConfigFromStored("org", "real-estate", stored);

  assert.equal(eff.leadFields.find((f) => f.key === "bedrooms")?.enabled, false);
  assert.equal(eff.qualificationFlow[0]?.fieldKey, "name");
  assert.ok(!eff.qualificationFlow.some((s) => s.fieldKey === "bedrooms"));
  assert.equal(eff.scoring.thresholds.hot, 70);
  assert.equal(eff.scoring.thresholds.warm, 50); // untouched
  assert.equal(eff.aiBehavior.tone, "formal and brief");
  assert.ok(eff.aiBehavior.rules.includes("Never quote a price."));
});

test("an AI behavior override actually reaches the system prompt", () => {
  const eff = effectiveConfigFromStored("org", "real-estate", {
    aiBehaviorOverrides: {
      persona: "a no-nonsense concierge",
      tone: "curt and precise",
      additionalRules: ["Only speak Spanish."],
      languages: ["Spanish"],
    },
  });
  const prompt = buildSystemPrompt(eff);
  assert.match(prompt, /no-nonsense concierge/);
  assert.match(prompt, /Curt and precise/);
  assert.match(prompt, /Only speak Spanish\./);
  assert.match(prompt, /Supported: Spanish\./);
});

test("a field enable/disable/order override changes the qualification flow", () => {
  const eff = effectiveConfigFromStored("org", "clinic", {
    fieldOverrides: [
      { key: "insurance", enabled: false },
      { key: "urgency", order: 5 },
    ],
    qualificationOverrides: [{ fieldKey: "urgency", order: 5 }],
  });
  assert.ok(!eff.qualificationFlow.some((s) => s.fieldKey === "insurance"));
  assert.equal(eff.qualificationFlow[0]?.fieldKey, "urgency");
});

test("a scoring threshold override changes the computed temperature", () => {
  const lead = {
    name: "A", phone: null, email: null, intent: "buy",
    customData: { location: "Riyadh", budget: 300000 },
  };
  const base = getEffectiveConfig({ organizationId: "o", industryTemplateId: "real-estate" });
  const strict = effectiveConfigFromStored("o", "real-estate", {
    scoringOverrides: { thresholds: { hot: 100, warm: 100 } },
  });
  const s1 = calculateLeadScore(lead, base.scoring);
  const s2 = calculateLeadScore(lead, strict.scoring);
  assert.equal(s1.score, s2.score); // same rules → same score
  assert.equal(s2.temperature, "COLD"); // but the stricter cut-off re-bands it
});

// ── validate (strict, pre-save) ───────────────────────────────────────────

test("validateStoredConfig accepts an empty blob and a sane override", () => {
  assert.equal(validateStoredConfig({}, realEstateTemplate).valid, true);
  assert.equal(
    validateStoredConfig(
      { aiBehaviorOverrides: { tone: "formal" }, scoringOverrides: { thresholds: { hot: 75, warm: 40 } } },
      realEstateTemplate,
    ).valid,
    true,
  );
});

test("validateStoredConfig rejects unknown fields, empty flow, bad thresholds, over-long text", () => {
  const unknown = validateStoredConfig(
    { fieldOverrides: [{ key: "not_a_real_field", enabled: true }] },
    realEstateTemplate,
  );
  assert.equal(unknown.valid, false);
  assert.ok(unknown.errors.some((e) => e.includes("not_a_real_field")));

  const allOff = validateStoredConfig(
    {
      fieldOverrides: realEstateTemplate.leadFields.map((f) => ({
        key: f.key,
        enabled: false,
      })),
    },
    realEstateTemplate,
  );
  assert.equal(allOff.valid, false);
  assert.ok(allOff.errors.some((e) => /enabled|flow/.test(e)));

  const badThreshold = validateStoredConfig(
    { scoringOverrides: { thresholds: { hot: 10, warm: 80 } } },
    realEstateTemplate,
  );
  assert.equal(badThreshold.valid, false);
  assert.ok(badThreshold.errors.some((e) => /hot >= warm/.test(e)));

  const outOfRange = validateStoredConfig(
    { scoringOverrides: { thresholds: { hot: 5000, warm: 10 } } },
    realEstateTemplate,
  );
  assert.equal(outOfRange.valid, false);

  const longText = validateStoredConfig(
    { aiBehaviorOverrides: { persona: "x".repeat(500) } },
    realEstateTemplate,
  );
  assert.equal(longText.valid, false);
});

test("validateStoredConfig rejects a scoring rule set that exceeds 100", () => {
  const result = validateStoredConfig(
    {
      scoringOverrides: {
        rules: [
          { kind: "presence", fieldKey: "location", maxPoints: 90, points: 90, whenMissing: 0 },
          { kind: "presence", fieldKey: "budget", maxPoints: 90, points: 90, whenMissing: 0 },
        ],
      },
    },
    realEstateTemplate,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /100/.test(e)));
});

// ── diff (form → minimal overrides) ───────────────────────────────────────

test("diffAiBehavior emits only real deltas", () => {
  const base = realEstateTemplate.aiBehavior;
  const noChange = diffAiBehavior(base, {
    persona: base.persona, goal: base.goal, tone: base.tone, style: base.style,
    domainContext: base.domainContext ?? "",
    languages: [...base.languages], additionalRules: [],
  });
  assert.equal(noChange, undefined);

  const changed = diffAiBehavior(base, {
    persona: base.persona, goal: base.goal, tone: "brand new tone", style: base.style,
    domainContext: base.domainContext ?? "",
    languages: [...base.languages], additionalRules: ["Extra rule."],
  });
  assert.deepEqual(changed, { tone: "brand new tone", additionalRules: ["Extra rule."] });
});

test("diffQualification emits fieldOverrides + qualificationOverrides for changes only", () => {
  const rows = realEstateTemplate.leadFields.map((f) => ({
    key: f.key,
    enabled: f.key !== "bedrooms",
    order: f.key === "name" ? 1 : f.order,
    questionHint: "",
  }));
  const diff = diffQualification(realEstateTemplate, rows);
  assert.ok(diff.fieldOverrides.some((o) => o.key === "bedrooms" && o.enabled === false));
  assert.ok(diff.fieldOverrides.some((o) => o.key === "name" && o.order === 1));
  // unchanged fields produce nothing
  assert.ok(!diff.fieldOverrides.some((o) => o.key === "location"));
});

test("diffScoringThresholds returns only changed cut-offs", () => {
  const base = realEstateTemplate.scoring.thresholds;
  assert.equal(diffScoringThresholds(base, { hot: base.hot, warm: base.warm }), undefined);
  assert.deepEqual(diffScoringThresholds(base, { hot: 70, warm: base.warm }), { hot: 70 });
});

test("compactStoredConfig strips empty containers", () => {
  assert.deepEqual(
    compactStoredConfig({ fieldOverrides: [], scoringOverrides: {}, aiBehaviorOverrides: {} }),
    {},
  );
});
