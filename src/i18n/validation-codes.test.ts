import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "./dictionaries/en.ts";
import { ar } from "./dictionaries/ar.ts";
import { hasTranslation } from "./translate.ts";
import {
  validateEmail,
  validatePassword,
  validateLoginPassword,
  validateOrgName,
  validateIndustrySlug,
} from "../lib/auth/validation.ts";
import { mapOnboardingErrorCode } from "../lib/org/onboarding-errors.ts";
import { validateFollowUpTemplate } from "../lib/whatsapp/validation.ts";

function bothResolve(path: string) {
  assert.ok(hasTranslation(en, path), `en missing ${path}`);
  assert.ok(hasTranslation(ar, path), `ar missing ${path}`);
}

test("every auth/onboarding validation code resolves in both locales", () => {
  const codes = [
    validateEmail("")!.code,
    validateEmail("bad")!.code,
    validatePassword("")!.code,
    validatePassword("short")!.code,
    validatePassword("x".repeat(100))!.code,
    validateLoginPassword("")!.code,
    validateOrgName("")!.code,
    validateOrgName("a")!.code,
    validateOrgName("x".repeat(999))!.code,
    validateIndustrySlug("", [])!.code,
    validateIndustrySlug("nope", ["real-estate"])!.code,
  ];
  for (const code of codes) bothResolve(`validation.${code}`);
});

test("every onboarding RPC error code resolves in both locales", () => {
  const codes = [
    mapOnboardingErrorCode({ code: "23505", message: "already belongs" }),
    mapOnboardingErrorCode({ code: "23505", message: "dup" }),
    mapOnboardingErrorCode({ code: "28000" }),
    mapOnboardingErrorCode({ code: "22023" }),
    mapOnboardingErrorCode({}),
  ];
  for (const code of codes) bothResolve(code);
});

test("every WhatsApp validation code resolves in both locales", () => {
  bothResolve(validateFollowUpTemplate({ name: "Bad!" }).error!);
  bothResolve(validateFollowUpTemplate({ name: "ok", language: "1" }).error!);
  for (const key of Object.keys(en.whatsapp.validation)) {
    bothResolve(`whatsapp.validation.${key}`);
  }
});

test("static error-code namespaces are fully covered in both locales", () => {
  const walk = (obj: object, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = `${prefix}.${k}`;
      if (typeof v === "string") bothResolve(path);
      else if (v && typeof v === "object") walk(v as object, path);
    }
  };
  walk(en.auth.errors, "auth.errors");
  walk(en.onboarding.errors, "onboarding.errors");
  walk(en.errors.leads, "errors.leads");
  walk(en.settingsAi.errors, "settingsAi.errors");
  walk(en.whatsapp.errors, "whatsapp.errors");
  walk(en.whatsapp.results, "whatsapp.results");
});
