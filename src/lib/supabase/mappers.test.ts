import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appTemperatureToDb,
  dbTemperatureToApp,
  leadRowToRecord,
  leadWriteToInsert,
} from "./mappers.ts";
import type { Tables } from "./types.ts";

const row = (over: Partial<Tables<"leads">> = {}): Tables<"leads"> => ({
  id: "lead_1",
  organization_id: "org_1",
  name: "محمد",
  phone: null,
  email: null,
  intent: "buy",
  custom_data: {
    location: "Riyadh",
    budget: 1_000_000,
    property_type: "apartment",
    bedrooms: 4,
    financing: true,
    timeline: "1 week",
  },
  score: 100,
  temperature: "hot",
  status: "qualified",
  source: "chat",
  creation_request_id: null,
  created_at: "2026-09-04T00:00:00Z",
  updated_at: "2026-09-04T00:00:00Z",
  ...over,
});

test("temperature maps between db (lowercase) and app (uppercase)", () => {
  assert.equal(dbTemperatureToApp("hot"), "HOT");
  assert.equal(dbTemperatureToApp("warm"), "WARM");
  assert.equal(dbTemperatureToApp("cold"), "COLD");
  assert.equal(appTemperatureToDb("HOT"), "hot");
  assert.equal(appTemperatureToDb("WARM"), "warm");
  assert.equal(appTemperatureToDb("COLD"), "cold");
});

test("leadRowToRecord maps snake_case row to camelCase record", () => {
  const record = leadRowToRecord(row());
  assert.equal(record.id, "lead_1");
  assert.equal(record.organizationId, "org_1");
  assert.equal(record.temperature, "HOT");
  assert.equal(record.score, 100);
  assert.equal(record.status, "qualified");
  assert.deepEqual(record.lead, {
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

test("leadRowToRecord is null-safe and normalizes custom_data", () => {
  const record = leadRowToRecord({
    ...row(),
    name: null,
    intent: null,
    custom_data: null as unknown as Tables<"leads">["custom_data"],
    score: "oops" as unknown as number,
  });
  assert.equal(record.lead.name, null);
  assert.equal(record.lead.intent, null);
  assert.deepEqual(record.lead.customData, {});
  assert.equal(record.score, 0);
});

test("leadWriteToInsert maps camelCase back to snake_case columns", () => {
  const insert = leadWriteToInsert({
    organizationId: "org_9",
    lead: {
      name: "Ahmed",
      phone: "+966555555555",
      email: null,
      intent: "buy",
      customData: { location: "Jeddah", budget: 800_000 },
    },
    score: 55,
    temperature: "WARM",
    status: "new",
    source: "chat",
  });
  assert.deepEqual(insert, {
    organization_id: "org_9",
    name: "Ahmed",
    phone: "+966555555555",
    email: null,
    intent: "buy",
    custom_data: { location: "Jeddah", budget: 800_000 },
    score: 55,
    temperature: "warm",
    status: "new",
    source: "chat",
  });
});

test("real-estate customData round-trips through custom_data only", () => {
  const insert = leadWriteToInsert({
    organizationId: "org_re",
    lead: {
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
    },
    score: 100,
    temperature: "HOT",
  });
  // industry fields land in custom_data, never as columns
  assert.deepEqual(insert.custom_data, {
    location: "Riyadh",
    budget: 1_000_000,
    property_type: "apartment",
    bedrooms: 4,
    financing: true,
    timeline: "1 week",
  });
  for (const k of ["budget", "property_type", "bedrooms", "financing", "location", "timeline"]) {
    assert.equal(k in insert, false);
  }
});

test("clinic customData round-trips through custom_data only", () => {
  const insert = leadWriteToInsert({
    organizationId: "org_clinic",
    lead: {
      name: "Ahmed",
      phone: "+966555555555",
      email: null,
      intent: null,
      customData: {
        service: "Dental Cleaning",
        doctor: "Dr. Ahmed",
        appointment_date: "2026-09-10",
        insurance: true,
        urgency: "high",
      },
    },
    score: 100,
    temperature: "HOT",
  });
  assert.equal(insert.name, "Ahmed");
  assert.equal(insert.phone, "+966555555555");
  assert.equal(insert.intent, null);
  assert.deepEqual(insert.custom_data, {
    service: "Dental Cleaning",
    doctor: "Dr. Ahmed",
    appointment_date: "2026-09-10",
    insurance: true,
    urgency: "high",
  });
  for (const k of ["service", "doctor", "appointment_date", "insurance", "urgency"]) {
    assert.equal(k in insert, false);
  }
});

test("leadWriteToInsert omits optional fields when not provided", () => {
  const insert = leadWriteToInsert({
    organizationId: "org_9",
    lead: {
      name: null,
      phone: null,
      email: null,
      intent: null,
      customData: {},
    },
    score: 0,
    temperature: "COLD",
  });
  assert.equal("status" in insert, false);
  assert.equal("source" in insert, false);
  assert.equal(insert.temperature, "cold");
  assert.deepEqual(insert.custom_data, {});
});
