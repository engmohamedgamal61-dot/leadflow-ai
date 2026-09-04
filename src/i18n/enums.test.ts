import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "./dictionaries/en.ts";
import { ar } from "./dictionaries/ar.ts";
import { hasTranslation } from "./translate.ts";
import {
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
} from "../lib/leads/list-params.ts";
import {
  CONFIG_MANAGE_ROLES,
  LEAD_MANAGE_ROLES,
  LEAD_WRITE_ROLES,
} from "../lib/org/roles.ts";

const ALL_ROLES = new Set([
  ...LEAD_WRITE_ROLES,
  ...LEAD_MANAGE_ROLES,
  ...CONFIG_MANAGE_ROLES,
  "viewer",
]);

const FOLLOW_UP_STATUSES = ["pending", "processing", "completed", "failed", "cancelled"];
const WHATSAPP_STATUSES = ["connected", "disconnected", "error", "pending"];
const CALENDAR_CONNECTION_STATUSES = ["connected", "disconnected", "error", "pending"];
const APPOINTMENT_STATUSES = ["scheduled", "rescheduled", "cancelled", "completed", "no_show"];

function bothHave(path: string) {
  assert.ok(hasTranslation(en, path), `en missing ${path}`);
  assert.ok(hasTranslation(ar, path), `ar missing ${path}`);
}

test("every lead status is translated in both locales", () => {
  for (const s of LEAD_STATUSES) bothHave(`statuses.${s}`);
});

test("every temperature is translated in both locales", () => {
  for (const t of LEAD_TEMPERATURES) bothHave(`temperatures.${t}`);
});

test("every membership role is translated in both locales", () => {
  for (const r of ALL_ROLES) bothHave(`roles.${r}`);
});

test("every follow-up status is translated in both locales", () => {
  for (const s of FOLLOW_UP_STATUSES) bothHave(`followUps.status.${s}`);
});

test("every WhatsApp connection status is translated in both locales", () => {
  for (const s of WHATSAPP_STATUSES) bothHave(`whatsapp.status.${s}`);
});

test("every timeline event title key exists in both locales", () => {
  const eventKeys = Object.keys(en.events);
  for (const k of eventKeys) bothHave(`events.${k}`);
});

test("every calendar connection status is translated in both locales", () => {
  for (const s of CALENDAR_CONNECTION_STATUSES) bothHave(`calendar.status.${s}`);
});

test("every appointment status is translated in both locales", () => {
  for (const s of APPOINTMENT_STATUSES) bothHave(`appointmentStatuses.${s}`);
});
