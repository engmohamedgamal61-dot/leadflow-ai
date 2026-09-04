import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "./crypto.ts";

const KEY = "a".repeat(64); // 32 bytes
const KEY2 = "b".repeat(64);

test("encrypt → decrypt round-trips", () => {
  const secret = "EAAG_super_secret_meta_access_token_value";
  const ct = encryptToken(secret, KEY);
  assert.notEqual(ct, secret);
  assert.ok(ct.startsWith("v1."));
  assert.equal(decryptToken(ct, KEY), secret);
});

test("ciphertext differs each time (random IV)", () => {
  const a = encryptToken("x", KEY);
  const b = encryptToken("x", KEY);
  assert.notEqual(a, b);
  assert.equal(decryptToken(a, KEY), "x");
  assert.equal(decryptToken(b, KEY), "x");
});

test("decrypt fails on wrong key, tampered ciphertext, or malformed input", () => {
  const ct = encryptToken("secret", KEY);
  assert.throws(() => decryptToken(ct, KEY2));

  const parts = ct.split(".");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptToken(parts.join("."), KEY));

  assert.throws(() => decryptToken("not-a-token", KEY));
  assert.throws(() => decryptToken("v1.a.b", KEY));
});

test("a non-32-byte key is rejected", () => {
  assert.throws(() => encryptToken("x", "abcd"));
});
