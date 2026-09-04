import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "./dictionaries/en.ts";
import { ar } from "./dictionaries/ar.ts";
import { hasTranslation } from "./translate.ts";
import { realEstateTemplate } from "../lib/config/templates/real-estate.ts";
import { clinicTemplate } from "../lib/config/templates/clinic.ts";

const TEMPLATES = [realEstateTemplate, clinicTemplate];

function bothResolve(path: string) {
  assert.ok(hasTranslation(en, path), `en missing ${path}`);
  assert.ok(hasTranslation(ar, path), `ar missing ${path}`);
}

test("every field labelKey in RE + Clinic resolves in both locales", () => {
  for (const tpl of TEMPLATES) {
    for (const field of tpl.leadFields) {
      assert.ok(field.labelKey, `${tpl.slug}.${field.key} has no labelKey`);
      bothResolve(field.labelKey!);
    }
  }
});

test("every select-option labelKey resolves in both locales", () => {
  for (const tpl of TEMPLATES) {
    for (const field of tpl.leadFields) {
      for (const opt of field.options ?? []) {
        assert.ok(opt.labelKey, `${tpl.slug}.${field.key}.${opt.value} has no labelKey`);
        bothResolve(opt.labelKey!);
      }
    }
  }
});

test("every template nameKey / descriptionKey resolves in both locales", () => {
  for (const tpl of TEMPLATES) {
    bothResolve(tpl.nameKey!);
    bothResolve(tpl.descriptionKey!);
  }
});

test("canonical values are unchanged by localization (pinned)", () => {
  // Field keys — what extraction / scoring / the DB use.
  assert.deepEqual(
    realEstateTemplate.leadFields.map((f) => f.key),
    ["name", "intent", "location", "budget", "property_type", "bedrooms", "financing", "timeline"],
  );
  assert.deepEqual(
    clinicTemplate.leadFields.map((f) => f.key),
    ["name", "phone", "service", "doctor", "appointment_date", "insurance", "urgency"],
  );
  // Option values.
  const intent = realEstateTemplate.leadFields.find((f) => f.key === "intent");
  assert.deepEqual(intent?.options?.map((o) => o.value), ["buy", "rent"]);
  const urgency = clinicTemplate.leadFields.find((f) => f.key === "urgency");
  assert.deepEqual(urgency?.options?.map((o) => o.value), ["high", "medium", "low"]);
  // Scoring cases still key off canonical values.
  const scoreIntent = realEstateTemplate.scoring.rules.find(
    (r) => r.fieldKey === "intent" && r.kind === "match",
  );
  assert.deepEqual(Object.keys((scoreIntent as { cases: object }).cases), ["buy", "rent"]);
});
