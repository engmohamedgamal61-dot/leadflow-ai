import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUsageRow, recordAiUsage } from "./service.ts";
import type { RecordUsageInput } from "./types.ts";

const base: RecordUsageInput = {
  organizationId: "org-1",
  requestType: "chat_reply",
  model: "claude-sonnet-5",
  channel: "web",
  usage: { inputTokens: 1500, outputTokens: 320 },
  conversationId: "conv-1",
  leadId: "lead-1",
  requestId: "11111111-1111-4111-8111-111111111111",
  occurredAt: new Date("2026-09-08T09:00:00Z"),
};

/** Minimal fake of the supabase-js client used by the service. */
function fakeDb() {
  const calls: { table: string; row: unknown; opts: unknown }[] = [];
  const db = {
    from(table: string) {
      return {
        upsert(row: unknown, opts: unknown) {
          calls.push({ table, row, opts });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, calls };
}

test("buildUsageRow computes cost from the centralized pricing config", () => {
  const row = buildUsageRow(base);
  assert.equal(row.organization_id, "org-1");
  assert.equal(row.request_type, "chat_reply");
  assert.equal(row.model, "claude-sonnet-5");
  assert.equal(row.input_tokens, 1500);
  assert.equal(row.output_tokens, 320);
  // (1500*2 + 320*10) / 1e6 = 0.0062
  assert.equal(row.estimated_cost_usd, 0.0062);
  assert.equal(row.occurred_at, "2026-09-08T09:00:00.000Z");
});

test("buildUsageRow drops a non-UUID request id", () => {
  assert.equal(buildUsageRow({ ...base, requestId: "not-a-uuid" }).request_id, null);
  assert.equal(buildUsageRow({ ...base, requestId: null }).request_id, null);
});

test("recordAiUsage writes one idempotent row", async () => {
  const { db, calls } = fakeDb();
  const result = await recordAiUsage(base, { db });
  assert.equal(result.ok, true);
  assert.equal(result.estimatedCostUsd, 0.0062);
  assert.equal(result.totalTokens, 1820);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "ai_usage_events");
  assert.deepEqual(calls[0].opts, {
    onConflict: "organization_id,request_id,request_type",
    ignoreDuplicates: true,
  });
});

test("recordAiUsage skips the write when there are no tokens", async () => {
  const { db, calls } = fakeDb();
  const result = await recordAiUsage(
    { ...base, usage: { inputTokens: 0, outputTokens: 0 } },
    { db },
  );
  assert.equal(result.ok, true);
  assert.equal(result.totalTokens, 0);
  assert.equal(calls.length, 0);
});

test("recordAiUsage never throws on a db error", async () => {
  const db = {
    from() {
      return {
        upsert() {
          return Promise.resolve({ error: { message: "boom" } });
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const result = await recordAiUsage(base, { db });
  assert.equal(result.ok, false);
  // The estimate is still reported for the caller's own bookkeeping.
  assert.equal(result.estimatedCostUsd, 0.0062);
});

test("recordAiUsage is a no-op without an organization id", async () => {
  const { db, calls } = fakeDb();
  const result = await recordAiUsage({ ...base, organizationId: "" }, { db });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});
