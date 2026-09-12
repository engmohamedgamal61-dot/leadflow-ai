import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, reportError } from "./report.ts";

test("redactSecrets: strips assigned credentials, keeps the key name", () => {
  assert.equal(
    redactSecrets('ANTHROPIC_API_KEY=sk-ant-abcdef1234567890'),
    "ANTHROPIC_API_KEY=[redacted]",
  );
  assert.equal(
    redactSecrets('{"access_token":"eyJhbGciOiJIUzI1NiJ9.payload.sig"}'),
    '{"access_token":"[redacted]"}',
  );
  assert.equal(
    redactSecrets("Authorization: Bearer abcd1234efgh5678"),
    "Authorization: Bearer [redacted]",
  );
  assert.equal(
    redactSecrets("client_secret = GOCSPX-abc123def456"),
    "client_secret = [redacted]",
  );
});

test("redactSecrets: strips bare high-entropy tokens anywhere", () => {
  assert.equal(
    redactSecrets("failed to send with sk-ant-api03-XXXXXXXXXXXXXXXX to Meta"),
    "failed to send with [redacted] to Meta",
  );
  assert.match(redactSecrets("token eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9abc"), /\[redacted\]/);
});

test("redactSecrets: leaves normal error text untouched", () => {
  const msg = "lead 1234 not found for organization abcd-efgh";
  assert.equal(redactSecrets(msg), msg);
  assert.equal(redactSecrets("connection refused (ECONNREFUSED)"), "connection refused (ECONNREFUSED)");
});

test("redactSecrets: short values that aren't secrets are left alone", () => {
  // "token=abc" — under the 8-char threshold, not treated as a secret.
  assert.equal(redactSecrets("token=abc"), "token=abc");
});

// ── reportError: alert dedup + never-throws (Supabase-outage hardening) ────

const realFetch = globalThis.fetch;
const realWebhookUrl = process.env.OPS_ALERT_WEBHOOK_URL;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realWebhookUrl === undefined) delete process.env.OPS_ALERT_WEBHOOK_URL;
  else process.env.OPS_ALERT_WEBHOOK_URL = realWebhookUrl;
});

test("reportError: always logs, even with no webhook configured", async (t) => {
  delete process.env.OPS_ALERT_WEBHOOK_URL;
  const calls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => calls.push(args));

  await reportError(new Error("boom"), { scope: "test.scope" });

  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /^\[ops\] /);
});

test("reportError: posts to the webhook once, then dedupes within the window for the same key", async () => {
  process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.test/alert";
  let posts = 0;
  globalThis.fetch = (async () => {
    posts++;
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  const ctx = { scope: "test.dedup", alertDedupKey: "unit-test-dedup-key", alertDedupWindowMs: 60_000 };
  await reportError(new Error("first"), ctx);
  await reportError(new Error("second"), ctx);
  await reportError(new Error("third"), ctx);

  assert.equal(posts, 1, "only the first alert within the window reached the webhook");
});

test("reportError: a different dedup key alerts independently", async () => {
  process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.test/alert";
  let posts = 0;
  globalThis.fetch = (async () => {
    posts++;
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  await reportError(new Error("a"), { scope: "s", alertDedupKey: `key-a-${Date.now()}` });
  await reportError(new Error("b"), { scope: "s", alertDedupKey: `key-b-${Date.now()}` });

  assert.equal(posts, 2);
});

test("reportError: with no alertDedupKey, every call alerts (no accidental dedup)", async () => {
  process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.test/alert";
  let posts = 0;
  globalThis.fetch = (async () => {
    posts++;
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  await reportError(new Error("a"), { scope: "s" });
  await reportError(new Error("b"), { scope: "s" });

  assert.equal(posts, 2);
});

test("reportError: control fields (alertDedupKey/alertDedupWindowMs) never leak into the logged context", async (t) => {
  delete process.env.OPS_ALERT_WEBHOOK_URL;
  const calls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => calls.push(args));

  await reportError(new Error("boom"), {
    scope: "test.scope",
    alertDedupKey: "should-not-appear",
    alertDedupWindowMs: 12345,
    requestId: "req-1",
  });

  const line = String(calls[0][0]).replace(/^\[ops\]\s*/, "");
  const report = JSON.parse(line);
  assert.equal("alertDedupKey" in report.context, false);
  assert.equal("alertDedupWindowMs" in report.context, false);
  assert.equal(report.context.requestId, "req-1");
});

test("reportError: a webhook that itself fails never throws or rejects", async () => {
  process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.test/alert";
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  await assert.doesNotReject(() =>
    reportError(new Error("boom"), { scope: "s", alertDedupKey: `key-${Date.now()}` }),
  );
});

test("reportError: an insecure or malformed webhook URL is never called", async () => {
  process.env.OPS_ALERT_WEBHOOK_URL = "http://not-https.example.test/alert"; // http, not https
  let posts = 0;
  globalThis.fetch = (async () => {
    posts++;
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  await reportError(new Error("boom"), { scope: "s" });
  assert.equal(posts, 0);
});
