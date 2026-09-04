import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateConnectionInput,
  validateFollowUpTemplate,
} from "./validation.ts";
import { graphApiVersion, isWithinSessionWindow } from "./config.ts";

test("validateConnectionInput accepts a well-formed connection", () => {
  const v = validateConnectionInput({
    phoneNumberId: "106540352242922",
    accessToken: "EAAG" + "x".repeat(40),
    wabaId: "102290129340398",
    displayPhoneNumber: "+1 555 078 3881",
  });
  assert.equal(v.ok, true);
  assert.equal(v.clean.phoneNumberId, "106540352242922");
});

test("validateConnectionInput rejects bad ids / short token (dictionary codes)", () => {
  const v = validateConnectionInput({ phoneNumberId: "abc", accessToken: "short", wabaId: "xx" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("whatsapp.validation.phoneNumberIdNumeric"));
  assert.ok(v.errors.includes("whatsapp.validation.accessTokenInvalid"));
  assert.ok(v.errors.every((e) => e.startsWith("whatsapp.validation.")));
});

test("validateFollowUpTemplate: blank clears, valid passes, bad rejected", () => {
  assert.deepEqual(validateFollowUpTemplate({ name: "", language: "" }), { ok: true, clean: null });
  assert.deepEqual(validateFollowUpTemplate({ name: "lead_follow_up", language: "ar" }), {
    ok: true,
    clean: { name: "lead_follow_up", language: "ar" },
  });
  const badName = validateFollowUpTemplate({ name: "Bad Name!" });
  assert.equal(badName.ok, false);
  assert.equal(badName.error, "whatsapp.validation.templateNameFormat");
  assert.equal(validateFollowUpTemplate({ name: "ok_name", language: "123" }).error, "whatsapp.validation.languageCodeInvalid");
});

test("graphApiVersion falls back for junk, keeps valid vNN.N", () => {
  assert.equal(graphApiVersion("v25.0"), "v25.0");
  assert.equal(graphApiVersion("garbage"), "v23.0");
  assert.equal(graphApiVersion(undefined), "v23.0");
});

test("isWithinSessionWindow: inside 24h true, outside false, missing false", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  assert.equal(isWithinSessionWindow("2026-09-04T00:00:00Z", now), true); // 12h
  assert.equal(isWithinSessionWindow("2026-09-02T00:00:00Z", now), false); // ~60h
  assert.equal(isWithinSessionWindow(null, now), false);
  assert.equal(isWithinSessionWindow("nonsense", now), false);
});
