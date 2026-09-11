import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeLike,
  normalizeEmail,
  normalizePhone,
  phoneMatchKey,
  pickDedupMatch,
} from "./lead-dedup.ts";

test("phoneMatchKey: every common way of writing the SAME Saudi number collapses to one key", () => {
  const forms = [
    "+966501234567",
    "00966501234567",
    "966501234567",
    "0501234567",
    "501234567",
    "+966 50 123 4567",
    "05-0123-4567",
    "(966) 50-123-4567",
  ];
  const keys = forms.map(phoneMatchKey);
  assert.ok(keys.every((k) => k === keys[0]), `all forms must share one key: ${JSON.stringify(keys)}`);
  assert.equal(keys[0], "501234567");
});

test("phoneMatchKey: different numbers get different keys", () => {
  assert.notEqual(phoneMatchKey("+966501111111"), phoneMatchKey("+966502222222"));
});

test("phoneMatchKey: too short to be safe → null (never used for dedup)", () => {
  for (const bad of [null, undefined, "", "12", "123456", "+9"]) {
    assert.equal(phoneMatchKey(bad), null);
  }
});

test("phoneMatchKey: a non-Saudi international number still gets a stable 9-digit tail", () => {
  // +1 415 555 0100 (US) — last 9 digits shared regardless of how it's typed.
  assert.equal(phoneMatchKey("+14155550100"), phoneMatchKey("014155550100"));
});

test("normalizePhone: recognises every Saudi shape as +966…", () => {
  for (const raw of ["0501234567", "501234567", "966501234567", "00966501234567"]) {
    assert.equal(normalizePhone(raw), "+966501234567", `input "${raw}"`);
  }
  // Already-international with a + is passed through digit-normalised.
  assert.equal(normalizePhone("+966 50 123 4567"), "+966501234567");
});

test("normalizePhone: junk / too short → null", () => {
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("12"), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(undefined), null);
});

test("normalizeEmail: lowercases and trims; rejects malformed addresses", () => {
  assert.equal(normalizeEmail("  Ali@Example.COM  "), "ali@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail("two@@at.com"), null);
  assert.equal(normalizeEmail("no-dot@localhost"), null);
  assert.equal(normalizeEmail("has space@example.com"), null);
  assert.equal(normalizeEmail(null), null);
});

test("pickDedupMatch: prefers email over phone when both are present", () => {
  const m = pickDedupMatch({ email: "a@b.com", phone: "0501234567" });
  assert.deepEqual(m, { by: "email", value: "a@b.com" });
});

test("pickDedupMatch: falls back to phone when there's no email", () => {
  const m = pickDedupMatch({ email: null, phone: "+966501234567" });
  assert.deepEqual(m, { by: "phone", matchKey: "501234567" });
});

test("pickDedupMatch: null when neither is usable", () => {
  assert.equal(pickDedupMatch({ email: null, phone: null }), null);
  assert.equal(pickDedupMatch({ email: "bad", phone: "12" }), null);
});

test("escapeLike: escapes % _ and backslash so a value is matched literally", () => {
  assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
});
