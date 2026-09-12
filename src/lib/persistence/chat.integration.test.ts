import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { persistCompletedTurn } from "./chat.ts";
import type { PersistChatTurnInput } from "./persist.ts";
import type { LeadData } from "../../types/chat.ts";

/**
 * `persistCompletedTurn` against a real local Postgres — the "ok" and real
 * "failed" branches that `chat.test.ts` can't reach (it calls
 * `createAdminClient()` unmocked, on purpose: see chat.ts's doc comment).
 * Skipped unless `LEADFLOW_DB_TEST_URL` + `LEADFLOW_DB_TEST_SERVICE_KEY` are
 * set (point them at a local `supabase start` instance — never production).
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const enabled = Boolean(URL && KEY);
const skip = enabled ? false : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let orgId = "";
const SLUG = `it-chat-${Date.now()}`;

// `persistCompletedTurn` calls `createAdminClient()` itself (no injection —
// see chat.ts) which reads exactly these two env vars. Point them at the
// same local instance `LEADFLOW_DB_TEST_URL`/`_SERVICE_KEY` name, and
// restore whatever was there afterwards so this file never leaks env state.
// Also cleared for the run: never let an ambient ops webhook receive a real
// POST from a deliberately-triggered test failure.
const ADMIN_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPS_ALERT_WEBHOOK_URL",
] as const;
const savedEnv: Record<string, string | undefined> = {};

before(async () => {
  if (!enabled) return;
  db = createClient(URL as string, KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await db
    .from("organizations")
    .insert({ name: "Chat Persist IT Org", slug: SLUG, industry_template_id: "real-estate" })
    .select("id")
    .single();
  if (error) throw error;
  orgId = data.id;

  for (const k of ADMIN_ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  delete process.env.OPS_ALERT_WEBHOOK_URL;
});

after(async () => {
  if (!enabled) return;
  for (const k of ADMIN_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  if (orgId) await db.from("organizations").delete().eq("id", orgId);
});

const reLead: LeadData = {
  name: "محمد",
  phone: null,
  email: null,
  intent: "buy",
  customData: { location: "Riyadh" },
};

const baseInput = (over: Partial<PersistChatTurnInput> = {}): PersistChatTurnInput => ({
  organizationId: orgId,
  conversationId: null,
  channel: "web",
  source: "chat",
  userMessage: "I want a 4-bed apartment in Riyadh",
  assistantMessage: "Great — what's your budget?",
  lead: reLead,
  score: 60,
  temperature: "WARM",
  ...over,
});

test("persistCompletedTurn: real DB, real org → ok, with real ids that read back", { skip }, async () => {
  const requestId = crypto.randomUUID();
  const outcome = await persistCompletedTurn(baseInput({ requestId }));
  assert.equal(outcome.status, "ok");
  if (outcome.status !== "ok") return; // narrows for TS below

  const lead = await db.from("leads").select("*").eq("id", outcome.leadId).single();
  assert.equal(lead.error, null);
  assert.equal(lead.data.organization_id, orgId);

  const conv = await db.from("conversations").select("*").eq("id", outcome.conversationId).single();
  assert.equal(conv.error, null);

  const messages = await db.from("messages").select("*").eq("conversation_id", outcome.conversationId);
  assert.equal(messages.data.length, 2);
});

test("persistCompletedTurn: nonexistent org → failed/permanent (real FK violation), never throws", { skip }, async (t) => {
  const reports: Array<{ scope: string; context: Record<string, unknown> }> = [];
  t.mock.method(console, "error", (line: string) => {
    // reportError logs `[ops] {...json...}` — parse it back out.
    const json = line.replace(/^\[ops\]\s*/, "");
    reports.push(JSON.parse(json));
  });

  const bogusOrgId = crypto.randomUUID(); // valid UUID, no such row
  const requestId = crypto.randomUUID();
  const outcome = await persistCompletedTurn(
    baseInput({ organizationId: bogusOrgId, requestId }),
  );

  assert.deepEqual(outcome, { status: "failed", reason: "permanent" });

  assert.equal(reports.length, 1, "exactly one structured error line was logged");
  const [report] = reports;
  assert.equal(report.scope, "chat.persistence");
  assert.equal(report.context.reason, "permanent");
  assert.equal(report.context.severity, "high");
  assert.equal(report.context.requestId, requestId);
  assert.equal(report.context.organizationId, bogusOrgId);
  // never a duplicate alert-storm control field leaking into the logged context
  assert.equal("alertDedupKey" in report.context, false);
});

test("persistCompletedTurn: retrying the SAME requestId after a transient-looking retry is still idempotent (no duplicate lead/conversation)", { skip }, async () => {
  const requestId = crypto.randomUUID();
  const first = await persistCompletedTurn(baseInput({ requestId }));
  assert.equal(first.status, "ok");
  const second = await persistCompletedTurn(baseInput({ requestId }));
  assert.equal(second.status, "ok");
  if (first.status !== "ok" || second.status !== "ok") return;

  assert.equal(second.conversationId, first.conversationId);
  assert.equal(second.leadId, first.leadId);

  const messages = await db.from("messages").select("*").eq("conversation_id", first.conversationId);
  assert.equal(messages.data.length, 2, "the replay did not insert a second pair of messages");
});
