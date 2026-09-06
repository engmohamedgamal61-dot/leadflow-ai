import { test } from "node:test";
import assert from "node:assert/strict";
import { isSignupGated, checkSignupInviteCode } from "./signup-gate.ts";

test("no SIGNUP_INVITE_CODE → open signup, any code accepted", () => {
  delete process.env.SIGNUP_INVITE_CODE;
  assert.equal(isSignupGated(), false);
  assert.equal(checkSignupInviteCode(undefined), true);
  assert.equal(checkSignupInviteCode("anything"), true);
});

test("SIGNUP_INVITE_CODE set → gated, exact match required", () => {
  process.env.SIGNUP_INVITE_CODE = "pilot-2026";
  assert.equal(isSignupGated(), true);
  assert.equal(checkSignupInviteCode("pilot-2026"), true);
  assert.equal(checkSignupInviteCode("  pilot-2026  "), true, "trims");
  assert.equal(checkSignupInviteCode("wrong"), false);
  assert.equal(checkSignupInviteCode(""), false);
  assert.equal(checkSignupInviteCode(undefined), false);
  assert.equal(checkSignupInviteCode(12345), false);
  delete process.env.SIGNUP_INVITE_CODE;
});

test("whitespace-only SIGNUP_INVITE_CODE is treated as unset", () => {
  process.env.SIGNUP_INVITE_CODE = "   ";
  assert.equal(isSignupGated(), false);
  assert.equal(checkSignupInviteCode("x"), true);
  delete process.env.SIGNUP_INVITE_CODE;
});
