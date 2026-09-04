import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEmail,
  validatePassword,
  validateLoginPassword,
  validateOrgName,
  validateIndustrySlug,
  validateSignup,
  validateLogin,
  validateOnboarding,
  PASSWORD_MIN_LENGTH,
} from "./validation.ts";

test("validateEmail accepts well-formed addresses, rejects the rest (codes)", () => {
  assert.equal(validateEmail("a@b.co"), undefined);
  assert.equal(validateEmail("  user@company.io  "), undefined);
  assert.equal(validateEmail("")?.code, "email.required");
  assert.equal(validateEmail("not-an-email")?.code, "email.invalid");
  assert.equal(validateEmail("a@b")?.code, "email.invalid");
  assert.equal(validateEmail("a b@c.com")?.code, "email.invalid");
  assert.equal(validateEmail(42)?.code, "email.required");
});

test("validatePassword enforces the minimum length (signup)", () => {
  assert.equal(validatePassword("x".repeat(PASSWORD_MIN_LENGTH)), undefined);
  const short = validatePassword("x".repeat(PASSWORD_MIN_LENGTH - 1));
  assert.equal(short?.code, "password.tooShort");
  assert.equal(short?.params?.min, PASSWORD_MIN_LENGTH);
  assert.equal(validatePassword("")?.code, "password.required");
  assert.equal(validatePassword("x".repeat(73))?.code, "password.tooLong");
});

test("validateLoginPassword only checks presence", () => {
  assert.equal(validateLoginPassword("short"), undefined);
  assert.equal(validateLoginPassword("")?.code, "password.loginRequired");
});

test("validateOrgName enforces 2..200 chars", () => {
  assert.equal(validateOrgName("Acme Realty"), undefined);
  assert.equal(validateOrgName(" ")?.code, "orgName.required");
  assert.equal(validateOrgName("A")?.code, "orgName.tooShort");
  assert.equal(validateOrgName("x".repeat(201))?.code, "orgName.tooLong");
});

test("validateIndustrySlug checks membership of the allowed registry list", () => {
  const allowed = ["real-estate", "clinic"];
  assert.equal(validateIndustrySlug("real-estate", allowed), undefined);
  assert.equal(validateIndustrySlug("clinic", allowed), undefined);
  assert.equal(validateIndustrySlug("automotive", allowed)?.code, "industry.invalid");
  assert.equal(validateIndustrySlug("", allowed)?.code, "industry.required");
  assert.equal(validateIndustrySlug("../etc", allowed)?.code, "industry.invalid");
});

test("validateSignup aggregates field errors and echoes trimmed input", () => {
  const bad = validateSignup(" nope ", "short");
  assert.equal(bad.ok, false);
  assert.ok(bad.fieldErrors.email);
  assert.ok(bad.fieldErrors.password);

  const good = validateSignup("  user@company.io ", "longenough");
  assert.equal(good.ok, true);
  assert.deepEqual(good.fieldErrors, {});
  assert.equal(good.email, "user@company.io");
  assert.equal(good.password, "longenough");
});

test("validateLogin is lenient on password but strict on email", () => {
  const r = validateLogin("user@company.io", "x");
  assert.equal(r.ok, true);
  const r2 = validateLogin("bad", "x");
  assert.equal(r2.ok, false);
  assert.ok(r2.fieldErrors.email);
  assert.equal(r2.fieldErrors.password, undefined);
});

test("validateOnboarding validates name + industry against the registry", () => {
  const allowed = ["real-estate", "clinic"];
  const ok = validateOnboarding("Acme Realty", "real-estate", allowed);
  assert.equal(ok.ok, true);
  assert.equal(ok.name, "Acme Realty");
  assert.equal(ok.industry, "real-estate");

  const bad = validateOnboarding("", "wat", allowed);
  assert.equal(bad.ok, false);
  assert.ok(bad.fieldErrors.name);
  assert.ok(bad.fieldErrors.industry);
});
