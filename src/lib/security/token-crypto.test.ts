import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptToken, encryptToken, readHexKeyFromEnv } from "./token-crypto.ts";

const KEY = "1".repeat(64);

test("encrypt → decrypt round-trips", () => {
  const ciphertext = encryptToken("super-secret-value", KEY);
  assert.equal(decryptToken(ciphertext, KEY), "super-secret-value");
});

test("ciphertext differs each time (random IV)", () => {
  assert.notEqual(encryptToken("same input", KEY), encryptToken("same input", KEY));
});

test("decrypt fails on wrong key, tampered ciphertext, or malformed input", () => {
  const ciphertext = encryptToken("value", KEY);
  assert.throws(() => decryptToken(ciphertext, "2".repeat(64)));
  assert.throws(() => decryptToken(ciphertext.slice(0, -4) + "abcd", KEY));
  assert.throws(() => decryptToken("not-even-formatted", KEY));
});

test("a non-32-byte key is rejected, naming the env var in the message", () => {
  assert.throws(
    () => encryptToken("value", "abcd", "MY_ENV_VAR"),
    /MY_ENV_VAR must be 64 hex characters/,
  );
});

test("readHexKeyFromEnv validates presence + shape", () => {
  delete process.env.SOME_TEST_KEY;
  assert.throws(() => readHexKeyFromEnv("SOME_TEST_KEY"), /SOME_TEST_KEY/);
  process.env.SOME_TEST_KEY = "not-hex";
  assert.throws(() => readHexKeyFromEnv("SOME_TEST_KEY"));
  process.env.SOME_TEST_KEY = KEY;
  assert.equal(readHexKeyFromEnv("SOME_TEST_KEY"), KEY);
  delete process.env.SOME_TEST_KEY;
});
