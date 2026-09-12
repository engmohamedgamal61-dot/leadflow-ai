#!/usr/bin/env node
/**
 * Load-test data seeding — Enterprise Readiness Phase 2/3. NOT application
 * code (lives under loadtest/, isolated from src/). Talks to the same local
 * Supabase the app under test uses, via the real RPCs/tables (no schema
 * bypass beyond what a service-role script legitimately does — inserting a
 * Google Calendar connection directly instead of driving a real OAuth flow,
 * exactly the same shape `upsertConnection` would write).
 *
 * Creates N organizations, each with:
 *   - a real auth user as owner (via create_organization_with_owner, same
 *     path onboarding.integration.test.ts exercises)
 *   - an enabled website widget, allowed_origins = [http://localhost:3000]
 *   - a "connected" Google Calendar connection (mock transport handles the
 *     actual Google calls; this just makes bookAppointment's DB-side resolve)
 *   - a handful of pre-existing leads (for dedup-hit scenarios)
 *
 * Writes loadtest/results/seed-data.json for the k6 scripts to read via
 * open()/JSON.parse() at init time.
 *
 * Usage: node loadtest/seed/seed.mjs [orgCount]
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encryptToken } from "../../src/lib/calendar/crypto.ts";
import { DEFAULT_CALENDAR_SETTINGS } from "../../src/lib/calendar/config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, "..", "results", "seed-data.json");

const URL = process.env.LEADFLOW_DB_TEST_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const CALENDAR_KEY = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;

if (!SERVICE_KEY || !ANON_KEY || !CALENDAR_KEY) {
  console.error(
    "Set LEADFLOW_DB_TEST_URL, LEADFLOW_DB_TEST_SERVICE_KEY, LEADFLOW_DB_TEST_ANON_KEY, CALENDAR_TOKEN_ENCRYPTION_KEY before seeding.",
  );
  process.exit(1);
}

const ORG_COUNT = Number(process.argv[2] ?? 30);
const PASSWORD = "loadtest-password-123!";
const stamp = Date.now();

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEMPLATES = ["real-estate", "clinic"];

function randomPhoneSuffix(n) {
  return String(500000000 + n).slice(0, 9);
}

async function seedOrg(index) {
  const email = `loadtest-org-${index}-${stamp}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created.error) throw new Error(`createUser org${index}: ${created.error.message}`);
  const userId = created.data.user.id;

  const userClient = createClient(URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await userClient.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`signIn org${index}: ${signIn.error.message}`);

  const industryTemplateId = TEMPLATES[index % TEMPLATES.length];
  const orgResult = await userClient.rpc("create_organization_with_owner", {
    p_name: `Load Test Org ${index} (${stamp})`,
    p_industry_template_id: industryTemplateId,
  });
  if (orgResult.error) throw new Error(`create_organization_with_owner org${index}: ${orgResult.error.message}`);
  const organizationId = orgResult.data.id;

  // Enable the website widget for this org — owner-authenticated write, same
  // path a real owner clicking "enable" in Settings -> Widget takes.
  const widget = await userClient
    .from("organization_widget_settings")
    .upsert(
      {
        organization_id: organizationId,
        enabled: true,
        allowed_origins: ["http://localhost:3000"],
      },
      { onConflict: "organization_id" },
    )
    .select("widget_key")
    .single();
  if (widget.error) throw new Error(`widget org${index}: ${widget.error.message}`);
  const widgetKey = widget.data.widget_key;

  // "Connect" Google Calendar directly (service-role insert — same row shape
  // upsertConnection writes; CALENDAR_MOCK_TRANSPORT means every Google call
  // the app makes against this connection returns a canned success, so what
  // matters here is the DB-side "a connection exists and is connected").
  const calendarConn = await admin.from("organization_calendar_connections").upsert(
    {
      organization_id: organizationId,
      provider: "google",
      status: "connected",
      calendar_id: "primary",
      calendar_email: email,
      timezone: DEFAULT_CALENDAR_SETTINGS.timezone,
      access_token_encrypted: encryptToken(`mock-access-${index}`, CALENDAR_KEY),
      refresh_token_encrypted: encryptToken(`mock-refresh-${index}`, CALENDAR_KEY),
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      settings: DEFAULT_CALENDAR_SETTINGS,
    },
    { onConflict: "organization_id" },
  );
  if (calendarConn.error) throw new Error(`calendar org${index}: ${calendarConn.error.message}`);

  // A handful of pre-existing leads so dedup scenarios have real rows to hit
  // (repeat-visitor by phone/email), not just first-contact inserts.
  const dedupPhones = [];
  const dedupEmails = [];
  for (let i = 0; i < 5; i += 1) {
    const phone = `05${randomPhoneSuffix(index * 100 + i)}`;
    const email2 = `existing-lead-${index}-${i}-${stamp}@example.test`;
    const lead = await admin
      .from("leads")
      .insert({
        organization_id: organizationId,
        name: `Existing Lead ${index}-${i}`,
        phone,
        email: email2,
        status: "new",
        score: 40,
        temperature: "warm",
        source: "chat",
      })
      .select("id")
      .single();
    if (lead.error) throw new Error(`lead org${index}-${i}: ${lead.error.message}`);
    dedupPhones.push(phone);
    dedupEmails.push(email2);
  }

  return {
    index,
    organizationId,
    industryTemplateId,
    ownerEmail: email,
    ownerPassword: PASSWORD,
    ownerUserId: userId,
    widgetKey,
    dedupPhones,
    dedupEmails,
  };
}

async function main() {
  console.log(`Seeding ${ORG_COUNT} orgs against ${URL} ...`);
  const orgs = [];
  // Sequential, not parallel: auth user creation + RPCs share the same
  // Postgres connection pool the app itself will be hammering during the
  // actual load test — no reason to contend with itself here too.
  for (let i = 0; i < ORG_COUNT; i += 1) {
    const org = await seedOrg(i);
    orgs.push(org);
    if ((i + 1) % 5 === 0 || i === ORG_COUNT - 1) {
      console.log(`  seeded ${i + 1}/${ORG_COUNT}`);
    }
  }

  const payload = {
    seededAt: new Date().toISOString(),
    stamp,
    supabaseUrl: URL,
    orgs,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_FILE} (${orgs.length} orgs).`);
}

main().catch((err) => {
  console.error("SEED FAILED:", err);
  process.exit(1);
});
