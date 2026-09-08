import { test } from "node:test";
import assert from "node:assert/strict";
import { readLimitedText, BODY_LIMITS } from "./body-limit.ts";

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://x.test/", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("reads a small body unchanged", async () => {
  const r = await readLimitedText(req('{"a":1}'), 1024);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.text, '{"a":1}');
});

test("rejects a body whose Content-Length exceeds the limit (before reading)", async () => {
  const r = await readLimitedText(req("x".repeat(50), { "content-length": "999999" }), 100);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.seenBytes, 999999);
});

test("rejects an oversized body even when Content-Length lies / is absent", async () => {
  const big = "y".repeat(5000);
  // Force a missing content-length by streaming.
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(big));
      c.close();
    },
  });
  const request = new Request("https://x.test/", {
    method: "POST",
    body: stream,
    // @ts-expect-error - duplex is required for a stream body in undici
    duplex: "half",
  });
  const r = await readLimitedText(request, 1000);
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.seenBytes > 1000);
});

test("the configured limits are sane ceilings", () => {
  assert.ok(BODY_LIMITS.chat >= 128 * 1024 && BODY_LIMITS.chat <= 2 * 1024 * 1024);
  assert.ok(BODY_LIMITS.inboundAction <= BODY_LIMITS.webhook);
});
