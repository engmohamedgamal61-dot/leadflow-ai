import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyWebhookChallenge,
  verifySignature,
} from "./signature.ts";

const SECRET = "app_secret_that_is_long_enough";
const VERIFY = "my-verify-token-value";

function sign(body: string, secret = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

test("verifyWebhookChallenge echoes the challenge on a correct token", () => {
  assert.equal(
    verifyWebhookChallenge(
      { mode: "subscribe", token: VERIFY, challenge: "abc123" },
      VERIFY,
    ),
    "abc123",
  );
});

test("verifyWebhookChallenge rejects wrong mode / token / missing config", () => {
  assert.equal(verifyWebhookChallenge({ mode: "unsub", token: VERIFY, challenge: "x" }, VERIFY), null);
  assert.equal(verifyWebhookChallenge({ mode: "subscribe", token: "wrong", challenge: "x" }, VERIFY), null);
  assert.equal(verifyWebhookChallenge({ mode: "subscribe", token: VERIFY, challenge: null }, VERIFY), null);
  assert.equal(verifyWebhookChallenge({ mode: "subscribe", token: VERIFY, challenge: "x" }, undefined), null);
  assert.equal(verifyWebhookChallenge({ mode: "subscribe", token: VERIFY, challenge: "x" }, "short"), null);
});

test("verifySignature accepts a correct HMAC over the raw body", () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}';
  assert.equal(verifySignature(body, sign(body), SECRET), true);
  assert.equal(verifySignature(Buffer.from(body), sign(body), SECRET), true);
});

test("verifySignature rejects tampered body / wrong secret / bad format / missing", () => {
  const body = '{"a":1}';
  assert.equal(verifySignature(body + " ", sign(body), SECRET), false);
  assert.equal(verifySignature(body, sign(body, "other_secret_long_enough"), SECRET), false);
  assert.equal(verifySignature(body, "sha256=zzz", SECRET), false);
  assert.equal(verifySignature(body, "deadbeef", SECRET), false);
  assert.equal(verifySignature(body, null, SECRET), false);
  assert.equal(verifySignature(body, sign(body), undefined), false);
  assert.equal(verifySignature(body, sign(body), "short"), false);
});
