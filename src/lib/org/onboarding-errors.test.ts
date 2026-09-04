import { test } from "node:test";
import assert from "node:assert/strict";
import { isAlreadyMemberError, mapOnboardingError } from "./onboarding-errors.ts";

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

test("mapOnboardingError produces friendly, non-leaky messages", () => {
  assert.match(
    mapOnboardingError({ code: "23505", message: "user already belongs to an organization" }),
    /already have an organization/i,
  );
  assert.match(mapOnboardingError({ code: "28000", message: "not authenticated" }), /session has expired/i);
  assert.match(mapOnboardingError({ code: "22023", message: "invalid industry template id" }), /check the organization details/i);
  assert.match(mapOnboardingError({ code: "P0001", message: "boom" }), /something went wrong/i);
  assert.match(mapOnboardingError({}), /something went wrong/i);
  // never echoes the raw Postgres message
  assert.doesNotMatch(mapOnboardingError({ code: "42P01", message: 'relation "x" does not exist' }), /relation/);
});
