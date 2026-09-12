import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { apiAssistant } from "./api-assistant.ts";
import { LEAD_DELIMITER, type ChatMessage } from "../../types/chat.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const messages: ChatMessage[] = [
  { id: "1", role: "user", content: "hi", createdAt: 0 },
];

/** A Response whose body streams the given chunks, one per queued microtask. */
function streamedResponse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function stubFetch(response: Response) {
  globalThis.fetch = (async () => response) as typeof fetch;
}

// ── the trailer / degraded-persistence signal (Supabase-outage hardening) ──

test("apiAssistant.send: normal trailer with degraded:false never fires onPersistenceDegraded", async () => {
  const trailer = JSON.stringify({ lead: null, conversationId: "conv-1", degraded: false });
  stubFetch(streamedResponse([`Hello there${LEAD_DELIMITER}${trailer}`]));

  let degradedFired = false;
  let conversationId: string | null | undefined;
  const reply = await apiAssistant.send(messages, {
    onConversation: (id) => {
      conversationId = id;
    },
    onPersistenceDegraded: () => {
      degradedFired = true;
    },
  });

  assert.equal(reply, "Hello there");
  assert.equal(conversationId, "conv-1");
  assert.equal(degradedFired, false);
});

test("apiAssistant.send: trailer with degraded:true fires onPersistenceDegraded, reply is untouched", async () => {
  const trailer = JSON.stringify({ lead: null, conversationId: "conv-2", degraded: true });
  stubFetch(streamedResponse([`Hello there${LEAD_DELIMITER}${trailer}`]));

  let degradedFired = false;
  const reply = await apiAssistant.send(messages, {
    onPersistenceDegraded: () => {
      degradedFired = true;
    },
  });

  assert.equal(reply, "Hello there");
  assert.equal(degradedFired, true);
});

test("apiAssistant.send: stream closes with a full reply but NO trailer at all → treated as degraded", async () => {
  // No LEAD_DELIMITER anywhere in the stream — connection dropped before the
  // trailer could be sent.
  stubFetch(streamedResponse(["Hello", " there"]));

  let degradedFired = false;
  let conversationCalled = false;
  const reply = await apiAssistant.send(messages, {
    onConversation: () => {
      conversationCalled = true;
    },
    onPersistenceDegraded: () => {
      degradedFired = true;
    },
  });

  assert.equal(reply, "Hello there");
  assert.equal(degradedFired, true, "a reply with no trailer must be treated as unknown/degraded");
  assert.equal(conversationCalled, false, "onConversation only fires when a trailer actually arrived");
});

test("apiAssistant.send: a malformed trailer is treated as degraded, not a crash", async () => {
  stubFetch(streamedResponse([`Hello${LEAD_DELIMITER}{not valid json`]));

  let degradedFired = false;
  let conversationId: string | null | undefined = "unset";
  const reply = await apiAssistant.send(messages, {
    onConversation: (id) => {
      conversationId = id;
    },
    onPersistenceDegraded: () => {
      degradedFired = true;
    },
  });

  assert.equal(reply, "Hello");
  assert.equal(degradedFired, true);
  assert.equal(conversationId, null, "a malformed trailer still calls onConversation(null), not garbage");
});

test("apiAssistant.send: an empty reply with no trailer does NOT fire onPersistenceDegraded", async () => {
  // Nothing was ever generated — there's no "answered but not saved" turn to
  // warn about; this is just an empty stream.
  stubFetch(streamedResponse([]));

  let degradedFired = false;
  const reply = await apiAssistant.send(messages, {
    onPersistenceDegraded: () => {
      degradedFired = true;
    },
  });

  assert.equal(reply, "");
  assert.equal(degradedFired, false);
});

test("apiAssistant.send: a non-ok response throws instead of silently degrading", async () => {
  const response = new Response(JSON.stringify({ errorCode: "chat.errors.busy" }), { status: 503 });
  stubFetch(response);

  await assert.rejects(() => apiAssistant.send(messages), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "chat.errors.busy");
    return true;
  });
});

test("apiAssistant.send: lead data in the trailer still reaches onLead alongside a degraded flag", async () => {
  const trailer = JSON.stringify({
    lead: { name: "Sara", phone: null, email: null, intent: "buy", customData: {} },
    conversationId: "conv-3",
    degraded: true,
  });
  stubFetch(streamedResponse([`Reply${LEAD_DELIMITER}${trailer}`]));

  let lead: unknown;
  let degradedFired = false;
  await apiAssistant.send(messages, {
    onLead: (l) => {
      lead = l;
    },
    onPersistenceDegraded: () => {
      degradedFired = true;
    },
  });

  assert.deepEqual(lead, { name: "Sara", phone: null, email: null, intent: "buy", customData: {} });
  assert.equal(degradedFired, true);
});
