import { test } from "node:test";
import assert from "node:assert/strict";
import {
  humanizeKey,
  formatFieldValue,
  buildLeadFieldViews,
  describeEvent,
} from "./lead-view.ts";
import type { LeadData } from "../../types/chat.ts";
import type { LeadFieldDefinition } from "../config/types.ts";

test("humanizeKey turns snake/camel keys into readable labels", () => {
  assert.equal(humanizeKey("appointment_date"), "Appointment date");
  assert.equal(humanizeKey("propertyType"), "Property type");
  assert.equal(humanizeKey("budget"), "Budget");
});

test("formatFieldValue renders each primitive type generically", () => {
  assert.equal(formatFieldValue(true), "Yes");
  assert.equal(formatFieldValue(false), "No");
  assert.equal(formatFieldValue(1000000), "1,000,000");
  assert.equal(formatFieldValue("Riyadh"), "Riyadh");
  assert.equal(formatFieldValue(null), "—");
  assert.equal(formatFieldValue(""), "—");
  assert.equal(formatFieldValue(["a", "b"]), "a, b");
  assert.equal(formatFieldValue({ x: 1 }), '{"x":1}');
});

const reFields: LeadFieldDefinition[] = [
  { key: "name", label: "Name", type: "text", required: true, enabled: true, order: 1 },
  { key: "budget", label: "Budget", type: "number", required: false, enabled: true, order: 2 },
  { key: "financing", label: "Financing", type: "boolean", required: false, enabled: true, order: 3 },
  { key: "timeline", label: "Timeline", type: "text", required: false, enabled: true, order: 4 },
];

test("buildLeadFieldViews renders core + template fields + unknown custom_data", () => {
  const lead: LeadData = {
    name: "Sara",
    phone: null,
    email: null,
    intent: "buy",
    customData: { budget: 900000, financing: true, walk_score: 88 },
  };
  const views = buildLeadFieldViews(lead, reFields);

  // core always present, in canonical order, even when null
  assert.deepEqual(
    views.filter((v) => v.source === "core").map((v) => v.key),
    ["name", "phone", "email", "intent"],
  );
  assert.equal(views.find((v) => v.key === "phone")?.display, "—");

  // template fields that have a value
  const budget = views.find((v) => v.key === "budget");
  assert.equal(budget?.source, "field");
  assert.equal(budget?.display, "900,000");
  assert.equal(views.find((v) => v.key === "financing")?.display, "Yes");
  // template field with no value is omitted
  assert.equal(views.some((v) => v.key === "timeline"), false);

  // unknown custom_data key still shows, humanized, marked "extra"
  const extra = views.find((v) => v.key === "walk_score");
  assert.equal(extra?.source, "extra");
  assert.equal(extra?.label, "Walk score");
  assert.equal(extra?.display, "88");
});

test("buildLeadFieldViews works for a clinic lead with no shared config", () => {
  const clinicLead: LeadData = {
    name: "Omar",
    phone: "+966555",
    email: null,
    intent: null,
    customData: {
      service: "Dental Cleaning",
      insurance: true,
      appointment_date: "next Tuesday",
    },
  };
  // no field defs passed → everything routes through the generic "extra" path
  const views = buildLeadFieldViews(clinicLead, []);
  assert.equal(views.find((v) => v.key === "service")?.display, "Dental Cleaning");
  assert.equal(views.find((v) => v.key === "insurance")?.display, "Yes");
  assert.equal(
    views.find((v) => v.key === "appointment_date")?.label,
    "Appointment date",
  );
});

test("describeEvent produces readable timeline entries for each event type", () => {
  assert.match(
    describeEvent({ event_type: "lead_created", metadata: { score: 55, temperature: "warm" }, created_at: "t" }).detail ?? "",
    /Initial score 55 · WARM/,
  );
  assert.equal(
    describeEvent({ event_type: "status_changed", metadata: { from: "new", to: "qualified" }, created_at: "t" }).detail,
    "New → Qualified",
  );
  assert.equal(
    describeEvent({ event_type: "score_changed", metadata: { from: 20, to: 65 }, created_at: "t" }).detail,
    "20 → 65",
  );
  assert.equal(
    describeEvent({ event_type: "some_future_event", metadata: null, created_at: "t" }).title,
    "Some future event",
  );
});
