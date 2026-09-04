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

test("validateEmail accepts well-formed addresses, rejects the rest", () => {
  assert.equal(validateEmail("a@b.co"), undefined);
  assert.equal(validateEmail("  user@company.io  "), undefined);
  assert.match(validateEmail("") ?? "", /enter your email/i);
  assert.match(validateEmail("not-an-email") ?? "", /valid email/i);
  assert.match(validateEmail("a@b") ?? "", /valid email/i);
  assert.match(validateEmail("a b@c.com") ?? "", /valid email/i);
  assert.match(validateEmail(42) ?? "", /enter your email/i);
});

test("validatePassword enforces the minimum length (signup)", () => {
  assert.equal(validatePassword("x".repeat(PASSWORD_MIN_LENGTH)), undefined);
  assert.match(
    validatePassword("x".repeat(PASSWORD_MIN_LENGTH - 1)) ?? "",
    /at least 8/i,
  );
  assert.match(validatePassword("") ?? "", /enter a password/i);
  assert.match(validatePassword("x".repeat(73)) ?? "", /at most 72/i);
});

test("validateLoginPassword only checks presence", () => {
  assert.equal(validateLoginPassword("short"), undefined);
  assert.match(validateLoginPassword("") ?? "", /enter your password/i);
});

test("validateOrgName enforces 2..200 chars", () => {
  assert.equal(validateOrgName("Acme Realty"), undefined);
  assert.match(validateOrgName(" ") ?? "", /enter your organization/i);
  assert.match(validateOrgName("A") ?? "", /at least 2/i);
  assert.match(validateOrgName("x".repeat(201)) ?? "", /at most 200/i);
});

test("validateIndustrySlug checks membership of the allowed registry list", () => {
  const allowed = ["real-estate", "clinic"];
  assert.equal(validateIndustrySlug("real-estate", allowed), undefined);
  assert.equal(validateIndustrySlug("clinic", allowed), undefined);
  assert.match(validateIndustrySlug("automotive", allowed) ?? "", /valid industry/i);
  assert.match(validateIndustrySlug("", allowed) ?? "", /choose an industry/i);
  assert.match(validateIndustrySlug("../etc", allowed) ?? "", /valid industry/i);
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
