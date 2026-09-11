import { test } from "node:test";
import assert from "node:assert/strict";
import { extractLeadAndActions } from "./agent-extraction.ts";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUEST_MAX_RETRIES,
} from "./anthropic.ts";
// Relative value import so this test runs under `node --test` (no `@/` alias resolution there).
import { getEffectiveConfig } from "../config/index.ts";

// Mirrors the `fakeClient` helper in sales-manager/answer.test.ts: a minimal
// stand-in for the Anthropic client, capturing both the call params and the
// `RequestOptions` (timeout/retries/signal) `.create()` was invoked with.
function fakeClient(create: (params: unknown, options: unknown) => unknown) {
  return { messages: { create: async (p: unknown, o: unknown) => create(p, o) } };
}

const config = getEffectiveConfig();
const messages = [{ role: "user" as const, content: "hi, I'm looking to buy" }];

test("extractLeadAndActions: happy path parses the lead JSON and normalizes usage", async () => {
  const client = fakeClient(() => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({ lead: { name: "Sara" }, proposed_actions: [] }),
      },
    ],
    usage: { input_tokens: 100, output_tokens: 20 },
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await extractLeadAndActions(client as any, messages, config);
  assert.equal(result.lead.name, "Sara");
  assert.deepEqual(result.proposedActions, []);
  assert.equal(result.usage?.inputTokens, 100);
  assert.equal(result.usage?.outputTokens, 20);
});

test("extractLeadAndActions: passes the request-call timeout/retry policy and any given signal", async () => {
  let seenOptions: Record<string, unknown> = {};
  const controller = new AbortController();
  const client = fakeClient((_p, o) => {
    seenOptions = o as Record<string, unknown>;
    return { content: [], usage: null };
  });
  await extractLeadAndActions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any,
    messages,
    config,
    { signal: controller.signal },
  );
  assert.equal(seenOptions.timeout, DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(seenOptions.maxRetries, DEFAULT_REQUEST_MAX_RETRIES);
  assert.equal(seenOptions.signal, controller.signal);
});

test("extractLeadAndActions: an already-aborted signal never throws — returns the safe empty sentinel", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = fakeClient((_p, o) => {
    const opts = o as { signal?: AbortSignal };
    if (opts?.signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    return { content: [], usage: null };
  });
  const result = await extractLeadAndActions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any,
    messages,
    config,
    { signal: controller.signal },
  );
  assert.equal(result.lead.name, null);
  assert.deepEqual(result.proposedActions, []);
  assert.deepEqual(result.rejectedActions, []);
  assert.equal(result.usage, null);
});

test("extractLeadAndActions: any other Anthropic failure also never throws", async () => {
  const client = fakeClient(() => {
    throw new Error("upstream 500");
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await extractLeadAndActions(client as any, messages, config);
  assert.equal(result.usage, null);
  assert.deepEqual(result.proposedActions, []);
});
