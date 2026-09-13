import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getOpsBacklogSummary } from "./backlog.ts";

/**
 * Real backlog data against a real local Postgres — confirms the
 * `service_role`-only SQL functions (migration `20260913090000_ops_
 * monitoring.sql`) actually count what they claim to, not just that they
 * execute without error on an empty database. Skipped unless
 * `LEADFLOW_DB_TEST_URL` + `LEADFLOW_DB_TEST_SERVICE_KEY` are set.
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const enabled = Boolean(URL && KEY);
const skip = enabled ? false : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let orgId = "";
let leadId = "";
const SLUG = `it-ops-backlog-${Date.now()}`;

const ADMIN_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

before(async () => {
  if (!enabled) return;
  db = createClient(URL as string, KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: org, error: orgError } = await db
    .from("organizations")
    .insert({ name: "Ops Backlog IT Org", slug: SLUG, industry_template_id: "real-estate" })
    .select("id")
    .single();
  if (orgError) throw orgError;
  orgId = org.id;

  const { data: lead, error: leadError } = await db
    .from("leads")
    .insert({ organization_id: orgId, name: "Backlog Test Lead", status: "new", score: 0, temperature: "cold" })
    .select("id")
    .single();
  if (leadError) throw leadError;
  leadId = lead.id;

  for (const k of ADMIN_ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
});

after(async () => {
  if (!enabled) return;
  for (const k of ADMIN_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  if (orgId) await db.from("organizations").delete().eq("id", orgId);
});

test("getOpsBacklogSummary: a due-but-unclaimed follow-up and a stuck one are both counted", { skip }, async () => {
  const dueAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const claimedAt = new Date(Date.now() - 30 * 60_000).toISOString(); // past the 15-min default stuck threshold

  await db.from("lead_follow_ups").insert([
    { organization_id: orgId, lead_id: leadId, scheduled_at: dueAt, status: "pending", source: "manual" },
    {
      organization_id: orgId,
      lead_id: leadId,
      scheduled_at: dueAt,
      status: "processing",
      claimed_at: claimedAt,
      source: "manual",
    },
  ]);

  const summary = await getOpsBacklogSummary();
  assert.equal(summary.status, "ok");
  assert.ok(summary.followUps!.pendingDue >= 1);
  assert.ok(summary.followUps!.stuckProcessing >= 1);
  assert.ok(summary.followUps!.oldestDueSeconds !== null);
  assert.ok(summary.followUps!.oldestDueSeconds! >= 590); // ~10 minutes, allowing test jitter
});

test("getOpsBacklogSummary: never exposes lead names, notes, or org names — counts only", { skip }, async () => {
  const summary = await getOpsBacklogSummary();
  const raw = JSON.stringify(summary);
  assert.doesNotMatch(raw, /Backlog Test Lead|Ops Backlog IT Org/);
});
