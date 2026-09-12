import { test } from "node:test";
import assert from "node:assert/strict";
import { persistCompletedTurn, type PersistTurnOutcome } from "./chat.ts";
import type { PersistChatTurnInput } from "./persist.ts";
import type { LeadData } from "../../types/chat.ts";

// `persistCompletedTurn`'s "ok" and real "failed" branches need a real
// Postgres (createAdminClient() is called unmocked, on purpose — see the
// file's doc comment) and are covered by `chat.integration.test.ts`. This
// file covers what's reachable without one: the "not_configured" branch,
// which is exactly what a local dev environment with no Supabase env vars
// hits today, and must keep hitting harmlessly.

const reLead: LeadData = {
  name: "Test User",
  phone: null,
  email: null,
  intent: "buy",
  customData: {},
};

const baseInput = (over: Partial<PersistChatTurnInput> = {}): PersistChatTurnInput => ({
  organizationId: "org-a",
  conversationId: null,
  channel: "web",
  source: "chat",
  userMessage: "hello",
  assistantMessage: "hi there",
  lead: reLead,
  score: 10,
  temperature: "COLD",
  ...over,
});

// Supabase admin-client env vars, saved/restored so this test never leaks
// state to other tests or depends on the ambient shell's env.
const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function withoutSupabaseEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  return fn().finally(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
    }
  });
}

test("persistCompletedTurn: Supabase not configured → not_configured, never throws", async () => {
  const outcome: PersistTurnOutcome = await withoutSupabaseEnv(() =>
    persistCompletedTurn(baseInput()),
  );
  assert.deepEqual(outcome, { status: "not_configured" });
});

test("persistCompletedTurn: not_configured is silent (no console.error)", async (t) => {
  const errorCalls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errorCalls.push(args);
  });
  await withoutSupabaseEnv(() => persistCompletedTurn(baseInput()));
  assert.equal(errorCalls.length, 0, "not_configured must never be reported as an error");
});
