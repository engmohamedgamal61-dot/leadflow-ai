import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isQualificationComplete,
  qualificationProgress,
  hasFieldValue,
} from "./qualification.ts";
import { getEffectiveConfig } from "../config/index.ts";
import { effectiveConfigFromStored } from "../config/organization-config.ts";
import type { LeadData } from "../../types/chat.ts";

const RE = getEffectiveConfig();
const CLINIC = getEffectiveConfig({ organizationId: "o", industryTemplateId: "clinic" });

const emptyLead: LeadData = {
  name: null,
  phone: null,
  email: null,
  intent: null,
  customData: {},
};

test("hasFieldValue treats empty string / null / NaN as missing", () => {
  const lead: LeadData = {
    ...emptyLead,
    name: "  ",
    intent: "buy",
    customData: { budget: 0, financing: false, bedrooms: Number.NaN },
  };
  assert.equal(hasFieldValue(lead, "name"), false);
  assert.equal(hasFieldValue(lead, "intent"), true);
  assert.equal(hasFieldValue(lead, "budget"), true); // 0 is a real number
  assert.equal(hasFieldValue(lead, "financing"), true); // false is a real value
  assert.equal(hasFieldValue(lead, "bedrooms"), false); // NaN
  assert.equal(hasFieldValue(lead, "missing"), false);
});

test("RE: qualification is complete only when every required field is present", () => {
  // required RE steps: intent, location, budget, timeline
  const partial: LeadData = {
    ...emptyLead,
    intent: "buy",
    customData: { location: "Riyadh", budget: 900000 },
  };
  assert.equal(isQualificationComplete(partial, RE), false);
  const p = qualificationProgress(partial, RE);
  assert.equal(p.requiredTotal, 4);
  assert.equal(p.requiredFilled, 3);

  const complete: LeadData = {
    ...emptyLead,
    intent: "buy",
    customData: { location: "Riyadh", budget: 900000, timeline: "1 month" },
  };
  assert.equal(isQualificationComplete(complete, RE), true);
});

test("Clinic: qualification completes on its own required fields", () => {
  // required clinic steps: name, service, appointment_date
  const partial: LeadData = {
    ...emptyLead,
    name: "Omar",
    customData: { service: "Dental Cleaning" },
  };
  assert.equal(isQualificationComplete(partial, CLINIC), false);

  const complete: LeadData = {
    ...emptyLead,
    name: "Omar",
    customData: { service: "Dental Cleaning", appointment_date: "next Tuesday" },
  };
  assert.equal(isQualificationComplete(complete, CLINIC), true);
});

test("stored config overrides change what 'complete' means", () => {
  // Disable `timeline` and `budget` for RE → only intent + location remain required
  const eff = effectiveConfigFromStored("o", "real-estate", {
    fieldOverrides: [
      { key: "timeline", enabled: false },
      { key: "budget", required: false },
    ],
    qualificationOverrides: [
      { fieldKey: "timeline", enabled: false },
      { fieldKey: "budget", required: false },
    ],
  });
  const lead: LeadData = {
    ...emptyLead,
    intent: "rent",
    customData: { location: "Jeddah" },
  };
  assert.equal(isQualificationComplete(lead, RE), false, "default config: not complete");
  assert.equal(isQualificationComplete(lead, eff), true, "override config: complete");
});

test("an empty flow is never 'complete'", () => {
  const noFlow = { ...RE, qualificationFlow: [] };
  assert.equal(isQualificationComplete(emptyLead, noFlow), false);
});
