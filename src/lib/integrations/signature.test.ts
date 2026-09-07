import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSignatureHeaders,
  computeSignature,
  verifySignature,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "./signature.ts";

const SECRET = "whsec_test_secret_value_123456789";
const BODY = '{"type":"lead.qualified","id":"abc"}';
const NOW = new Date("2026-09-07T12:00:00.000Z");

test("buildSignatureHeaders round-trips with verifySignature", () => {
  const headers = buildSignatureHeaders(SECRET, BODY, NOW);
  const res = verifySignature({
    secret: SECRET,
    body: BODY,
    signatureHeader: headers[SIGNATURE_HEADER],
    timestampHeader: headers[TIMESTAMP_HEADER],
    now: NOW,
  });
  assert.equal(res.ok, true);
});

test("accepts a bare hex signature (no sha256= prefix)", () => {
  const ts = Math.floor(NOW.getTime() / 1000);
  const res = verifySignature({
    secret: SECRET,
    body: BODY,
    signatureHeader: computeSignature(SECRET, ts, BODY),
    timestampHeader: String(ts),
    now: NOW,
  });
  assert.equal(res.ok, true);
});

test("rejects a tampered body", () => {
  const headers = buildSignatureHeaders(SECRET, BODY, NOW);
  const res = verifySignature({
    secret: SECRET,
    body: BODY + " ",
    signatureHeader: headers[SIGNATURE_HEADER],
    timestampHeader: headers[TIMESTAMP_HEADER],
    now: NOW,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad_signature");
});

test("rejects the wrong secret", () => {
  const headers = buildSignatureHeaders(SECRET, BODY, NOW);
  const res = verifySignature({
    secret: "whsec_a_different_secret_00000000",
    body: BODY,
    signatureHeader: headers[SIGNATURE_HEADER],
    timestampHeader: headers[TIMESTAMP_HEADER],
    now: NOW,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad_signature");
});

test("rejects a stale timestamp (replay protection)", () => {
  const headers = buildSignatureHeaders(SECRET, BODY, NOW);
  const later = new Date(NOW.getTime() + 6 * 60_000); // 6 min later, tol 5 min
  const res = verifySignature({
    secret: SECRET,
    body: BODY,
    signatureHeader: headers[SIGNATURE_HEADER],
    timestampHeader: headers[TIMESTAMP_HEADER],
    now: later,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "timestamp_out_of_tolerance");
});

test("a future-skewed timestamp within tolerance is fine", () => {
  const headers = buildSignatureHeaders(SECRET, BODY, NOW);
  const earlier = new Date(NOW.getTime() - 60_000);
  const res = verifySignature({
    secret: SECRET,
    body: BODY,
    signatureHeader: headers[SIGNATURE_HEADER],
    timestampHeader: headers[TIMESTAMP_HEADER],
    now: earlier,
  });
  assert.equal(res.ok, true);
});

test("rejects missing / malformed headers", () => {
  assert.equal(
    verifySignature({
      secret: SECRET,
      body: BODY,
      signatureHeader: null,
      timestampHeader: "123",
    }).reason,
    "missing_signature",
  );
  assert.equal(
    verifySignature({
      secret: SECRET,
      body: BODY,
      signatureHeader: "sha256=xyz",
      timestampHeader: "123",
    }).reason,
    "malformed_signature",
  );
  assert.equal(
    verifySignature({
      secret: SECRET,
      body: BODY,
      signatureHeader: `sha256=${"a".repeat(64)}`,
      timestampHeader: "not-a-number",
    }).reason,
    "malformed_timestamp",
  );
});
