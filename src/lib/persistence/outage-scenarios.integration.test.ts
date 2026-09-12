import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { persistCompletedTurn } from "./chat.ts";
import type { PersistChatTurnInput } from "./persist.ts";
import type { LeadData } from "../../types/chat.ts";
import { resolveOrgByWidgetKey, WidgetLookupError } from "../org/widget.ts";

/**
 * The six DB-outage scenarios named in the Supabase-outage hardening task,
 * run against a real local Postgres (`LEADFLOW_DB_TEST_URL` /
 * `LEADFLOW_DB_TEST_SERVICE_KEY` — a local `supabase start` instance, never
 * production) with the DB connection itself faulted deterministically (a
 * `global.fetch` override that always rejects, rather than actually killing
 * the container — this keeps the suite fast and avoids fighting
 * postgrest-js's own internal read-retries, which add ~7s per faulted GET).
 *
 *   A. DB unavailable before persistence begins (org resolution)
 *   B. DB fails during lead/message persistence
 *   C. assistant response succeeds but persistence fails afterward
 *   D. DB recovers and the same requestId is retried
 *   E. duplicate retry remains idempotent
 *   F. normal healthy path is unchanged
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const enabled = Boolean(URL && KEY);
const skip = enabled ? false : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let orgId = "";
const SLUG = `it-outage-${Date.now()}`;

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
    .insert({ name: "Outage Scenarios IT Org", slug: SLUG, industry_template_id: "real-estate" })
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
  name: "Outage Test",
  phone: null,
  email: null,
  intent: "buy",
  customData: {},
};

const baseInput = (over: Partial<PersistChatTurnInput> = {}): PersistChatTurnInput => ({
  organizationId: orgId,
  conversationId: null,
  channel: "web",
  source: "chat",
  userMessage: "hello",
  assistantMessage: "hi there",
  lead: reLead,
  score: 20,
  temperature: "COLD",
  ...over,
});

/** A DB client identical to the real one, except every request rejects. */
function unreachableClient() {
  return createClient(URL as string, KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (async () => {
        throw new TypeError("fetch failed (simulated Supabase outage)");
      }) as typeof fetch,
    },
  });
}

// ── A. DB unavailable before persistence begins (org resolution) ───────────

test("A. widget-key org resolution during an outage throws WidgetLookupError, not a bare null", { skip }, async () => {
  await assert.rejects(
    () => resolveOrgByWidgetKey(unreachableClient(), "11111111-1111-1111-1111-111111111111"),
    (err: unknown) => err instanceof WidgetLookupError,
  );
});

// ── B. DB fails during lead/message persistence ─────────────────────────────

test("B. persistCompletedTurn during an outage → failed/transient, never throws, no lead created", { skip }, async (t) => {
  // Route persistCompletedTurn's OWN createAdminClient() at the faulted URL —
  // it reads these two env vars itself (see chat.ts's doc comment).
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1"; // "bad port" — fails fast, no real listener
  const calls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => calls.push(args));
  t.after(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  });

  const before = await db.from("leads").select("id").eq("organization_id", orgId);
  const countBefore = before.data.length;

  const requestId = crypto.randomUUID();
  const outcome = await persistCompletedTurn(baseInput({ requestId }));

  assert.deepEqual(outcome, { status: "failed", reason: "transient" });
  assert.equal(calls.length, 1, "the outage was reported exactly once");
  const report = JSON.parse(String(calls[0][0]).replace(/^\[ops\]\s*/, ""));
  assert.equal(report.context.reason, "transient");
  assert.equal(report.context.severity, "high");

  // Uses the healthy `db` (not the faulted client) to confirm nothing leaked
  // through: a failed attempt must not leave a partial lead behind.
  const after = await db.from("leads").select("id").eq("organization_id", orgId);
  assert.equal(after.data.length, countBefore, "no lead was created by the failed attempt");
});

// ── C. assistant response succeeds but persistence fails afterward ─────────

test("C. a persistence failure is reported as 'failed', never silently as 'ok' — the caller can tell the reply-already-sent turn wasn't saved", { skip }, async () => {
  // `persistCompletedTurn` is only ever called (from conversation-service.ts)
  // AFTER the assistant's full reply has already been generated and streamed
  // to the client — this is what makes "failed" here equivalent to scenario
  // C: the reply already succeeded, and only the SAVE failed. Reusing the
  // real FK-violation case from chat.integration.test.ts's "failed/permanent"
  // test is the same shape; here we assert the CONTRACT that matters for C:
  // the outcome discriminates cleanly and is never conflated with "ok".
  const bogusOrgId = crypto.randomUUID();
  const outcome = await persistCompletedTurn(
    baseInput({ organizationId: bogusOrgId, requestId: crypto.randomUUID() }),
  );
  assert.notEqual(outcome.status, "ok");
  assert.equal(outcome.status, "failed");
});

// ── D. DB recovers and the same requestId is retried ────────────────────────

test("D. after the DB recovers, retrying the SAME requestId succeeds exactly once (no duplicate)", { skip }, async () => {
  const requestId = crypto.randomUUID();

  // First attempt: DB unreachable.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
  const failed = await persistCompletedTurn(baseInput({ requestId }));
  assert.equal(failed.status, "failed");

  // DB "recovers".
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  const recovered = await persistCompletedTurn(baseInput({ requestId }));
  assert.equal(recovered.status, "ok");
  if (recovered.status !== "ok") return;

  const messages = await db
    .from("messages")
    .select("*")
    .eq("conversation_id", recovered.conversationId);
  assert.equal(messages.data.length, 2, "exactly one turn's worth of messages, not duplicated");

  const leads = await db.from("leads").select("id").eq("id", recovered.leadId);
  assert.equal(leads.data.length, 1);
});

// ── E. duplicate retry remains idempotent (DB healthy throughout) ──────────

test("E. a duplicate retry with the same requestId while the DB is healthy is a no-op the second time", { skip }, async () => {
  const requestId = crypto.randomUUID();
  const first = await persistCompletedTurn(baseInput({ requestId }));
  const second = await persistCompletedTurn(baseInput({ requestId }));
  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
  if (first.status !== "ok" || second.status !== "ok") return;
  assert.equal(second.leadId, first.leadId);
  assert.equal(second.conversationId, first.conversationId);

  const messages = await db.from("messages").select("*").eq("conversation_id", first.conversationId);
  assert.equal(messages.data.length, 2);
});

// ── F. normal healthy path is unchanged ─────────────────────────────────────

test("F. the healthy path still returns ok with real, readable ids — unchanged by this hardening", { skip }, async () => {
  const outcome = await persistCompletedTurn(baseInput({ requestId: crypto.randomUUID() }));
  assert.equal(outcome.status, "ok");
  if (outcome.status !== "ok") return;
  const lead = await db.from("leads").select("*").eq("id", outcome.leadId).single();
  assert.equal(lead.error, null);
  assert.equal(lead.data.organization_id, orgId);
});
