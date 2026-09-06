import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "./report.ts";

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
