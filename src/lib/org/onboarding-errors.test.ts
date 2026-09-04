import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAlreadyMemberError,
  mapOnboardingErrorCode,
} from "./onboarding-errors.ts";

test("isAlreadyMemberError only matches the 23505 'already belongs' guard", () => {
  assert.equal(
    isAlreadyMemberError({ code: "23505", message: "user already belongs to an organization" }),
    true,
  );
  assert.equal(
    isAlreadyMemberError({ code: "23505", message: 'duplicate key value violates unique constraint "organizations_slug_key"' }),
    false,
  );
  assert.equal(isAlreadyMemberError({ code: "22023", message: "already belongs" }), false);
});

test("mapOnboardingErrorCode maps to dictionary codes, never raw Postgres text", () => {
  assert.equal(
    mapOnboardingErrorCode({ code: "23505", message: "user already belongs to an organization" }),
    "onboarding.errors.alreadyMember",
  );
  assert.equal(
    mapOnboardingErrorCode({ code: "23505", message: 'duplicate key value violates unique constraint "organizations_slug_key"' }),
    "onboarding.errors.createFailed",
  );
  assert.equal(mapOnboardingErrorCode({ code: "28000" }), "onboarding.errors.sessionExpired");
  assert.equal(mapOnboardingErrorCode({ code: "22023" }), "onboarding.errors.invalidDetails");
  assert.equal(mapOnboardingErrorCode({ code: "P0001", message: "boom" }), "onboarding.errors.generic");
  assert.equal(mapOnboardingErrorCode({}), "onboarding.errors.generic");
  assert.doesNotMatch(
    mapOnboardingErrorCode({ code: "42P01", message: 'relation "x" does not exist' }),
    /relation/,
  );
});
