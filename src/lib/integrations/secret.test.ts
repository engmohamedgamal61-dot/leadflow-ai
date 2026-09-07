import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateEndpointSecret,
  secretHint,
  encryptEndpointSecret,
  decryptEndpointSecret,
  SECRET_PREFIX,
} from "./secret.ts";

const KEY = "0".repeat(64);

test("generateEndpointSecret has the prefix and is high-entropy", () => {
  const a = generateEndpointSecret();
  const b = generateEndpointSecret();
  assert.ok(a.startsWith(SECRET_PREFIX));
  assert.notEqual(a, b);
  assert.ok(a.length > 40);
});

test("secretHint reveals only the prefix + last 6 chars", () => {
  const s = "whsec_ABCDEFGHIJKLMNOPqrstuv123456";
  const hint = secretHint(s);
  assert.equal(hint, "whsec_…123456");
  assert.ok(!hint.includes("ABCDEFGH"));
});

test("encrypt/decrypt round-trips with an injected key", () => {
  const secret = generateEndpointSecret();
  const enc = encryptEndpointSecret(secret, KEY);
  assert.notEqual(enc, secret);
  assert.match(enc, /^v1\./);
  assert.equal(decryptEndpointSecret(enc, KEY), secret);
});

test("decrypt with the wrong key throws", () => {
  const enc = encryptEndpointSecret("whsec_x", KEY);
  assert.throws(() => decryptEndpointSecret(enc, "1".repeat(64)));
});
