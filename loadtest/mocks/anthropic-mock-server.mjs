#!/usr/bin/env node
/**
 * Deterministic Anthropic API mock for load testing — Enterprise Readiness
 * Phase 2. NOT application code: the real app is pointed at this via the
 * `ANTHROPIC_BASE_URL` env var (natively supported by @anthropic-ai/sdk,
 * confirmed in node_modules/@anthropic-ai/sdk/client.js), so zero lines of
 * src/ change to use it.
 *
 * Implements just enough of POST /v1/messages to satisfy the real SDK:
 *   - streaming (chat reply, src/app/api/chat/route.ts + WhatsApp reply):
 *     a real SSE event sequence (message_start / content_block_start /
 *     content_block_delta* / content_block_stop / message_delta /
 *     message_stop), paced to approximate real Claude streaming latency.
 *   - non-streaming (lead extraction, AI Sales Manager plan/answer): a single
 *     JSON Message object. For an `output_config.format.type === "json_schema"`
 *     request (extraction), the text content is a valid lead JSON blob so
 *     `assembleLead` downstream has something real to normalize.
 *
 * Failure injection (Phase 6): POST /_control/scenario { "scenario": "..." }
 * sets the behavior for ALL subsequent /v1/messages calls until reset back to
 * "ok". Scenarios: ok | timeout | rate_limit_429 | server_error_500.
 * GET /_control/state reports the current scenario + a running request count
 * (so a load-test run can assert how many requests actually hit the mock).
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT ?? 9101);

// Paced to approximate real Claude latency, not to be instant — an SLO that
// assumes sub-second AI latency is not credible (see docs/loadtest SLOs).
// Override via env for different load profiles.
const STREAM_TTFB_MS = Number(process.env.MOCK_ANTHROPIC_STREAM_TTFB_MS ?? 350);
const STREAM_CHUNK_DELAY_MS = Number(process.env.MOCK_ANTHROPIC_STREAM_CHUNK_DELAY_MS ?? 60);
const NONSTREAM_LATENCY_MS = Number(process.env.MOCK_ANTHROPIC_NONSTREAM_LATENCY_MS ?? 400);

let scenario = "ok";
let requestCount = 0;
let scenarioHitCount = 0;

const REPLY_CHUNKS = [
  "Thanks for reaching out! ",
  "I'd love to help you find the right fit. ",
  "Could you tell me a bit about what you're looking for, ",
  "such as your budget and preferred area?",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sseEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function usage(inputTokens, outputTokens) {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

/**
 * Deterministic lead JSON, derived from the request rather than fixed —
 * lets k6 scripts control dedup/booking behavior by what they put in the
 * last user message, without the mock needing any real NLU:
 *
 *   - `PHONE:<digits>` in the message → extracted as that lead's phone
 *     (default "0511234567" if absent) — Scenario C (dedup) sends distinct
 *     or repeated PHONE: tokens to control same-contact vs. distinct-contact
 *     traffic precisely.
 *   - `BOOK_SLOT:<iso timestamp>` in the message → proposed_actions carries
 *     a book_appointment action for that slot — Scenario E (booking) drives
 *     the real AI-executed booking path, including concurrent-same-slot
 *     contention against the DB exclusion constraint.
 */
function extractionJsonText(lastUserMessage) {
  const phoneMatch = /PHONE:(\d{6,15})/.exec(lastUserMessage ?? "");
  const phone = phoneMatch ? phoneMatch[1] : "0511234567";

  const bookMatch = /BOOK_SLOT:([0-9T:\-+.Z]+)/.exec(lastUserMessage ?? "");
  const proposedActions = bookMatch
    ? [{ type: "book_appointment", scheduled_at: bookMatch[1], reason: "load test booking" }]
    : [];

  return JSON.stringify({
    lead: {
      name: "Load Test Lead",
      phone,
      email: null,
      intent: "buy",
    },
    proposed_actions: proposedActions,
  });
}

async function handleMessages(req, res, body) {
  requestCount += 1;

  if (scenario !== "ok") {
    scenarioHitCount += 1;
  }

  if (scenario === "timeout") {
    // Never respond — the caller's own timeout (ANTHROPIC_*_TIMEOUT_MS) must
    // fire. Hold the connection open; do not write headers.
    req.on("close", () => {});
    return;
  }
  if (scenario === "rate_limit_429") {
    res.writeHead(429, { "Content-Type": "application/json", "retry-after": "1" });
    res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "mock 429" } }));
    return;
  }
  if (scenario === "server_error_500") {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "mock 500" } }));
    return;
  }

  let parsed = {};
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    parsed = {};
  }

  const isStructured = parsed?.output_config?.format?.type === "json_schema";
  const isStreaming = parsed?.stream === true;
  const model = typeof parsed?.model === "string" ? parsed.model : "claude-sonnet-5";
  const inputTokens = Math.max(50, Math.round((JSON.stringify(parsed?.messages ?? "").length) / 4));

  const messageId = `msg_mock_${randomUUID().slice(0, 8)}`;

  if (isStreaming) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    await sleep(STREAM_TTFB_MS);

    sseEvent(res, "message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: usage(inputTokens, 0),
      },
    });
    sseEvent(res, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });

    let outputTokens = 0;
    for (const chunk of REPLY_CHUNKS) {
      await sleep(STREAM_CHUNK_DELAY_MS);
      outputTokens += Math.max(1, Math.round(chunk.length / 4));
      sseEvent(res, "content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: chunk },
      });
    }

    sseEvent(res, "content_block_stop", { type: "content_block_stop", index: 0 });
    sseEvent(res, "message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: usage(inputTokens, outputTokens),
    });
    sseEvent(res, "message_stop", { type: "message_stop" });
    res.end();
    return;
  }

  // Non-streaming: extraction (structured) or a Sales Manager plan/answer call.
  // The extraction request's messages are [...full history, assistant reply,
  // "Return the JSON..." instruction] — the PHONE:/BOOK_SLOT: trigger tokens
  // (if any) are in the customer's own turn, somewhere in that history, not
  // necessarily the last message — so scan every message's content, not just
  // the last one.
  await sleep(NONSTREAM_LATENCY_MS);
  const allContent = Array.isArray(parsed?.messages)
    ? parsed.messages.map((m) => (typeof m?.content === "string" ? m.content : "")).join("\n")
    : "";
  const text = isStructured ? extractionJsonText(allContent) : "Mock non-streaming reply text.";
  const outputTokens = Math.max(1, Math.round(text.length / 4));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      id: messageId,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: usage(inputTokens, outputTokens),
    }),
  );
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "POST" && url.pathname === "/_control/scenario") {
    const body = await readBody(req);
    try {
      const { scenario: next } = JSON.parse(body || "{}");
      if (!["ok", "timeout", "rate_limit_429", "server_error_500"].includes(next)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unknown scenario" }));
        return;
      }
      scenario = next;
      scenarioHitCount = 0;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ scenario }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid body" }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/_control/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ scenario, requestCount, scenarioHitCount }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    const body = await readBody(req);
    try {
      await handleMessages(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: String(err) } }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[anthropic-mock] listening on http://localhost:${PORT}`);
});
