import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canChangeIndustry,
  decideIndustryChange,
  selectableIndustrySlugs,
} from "./industry.ts";
import type { OrganizationMemberRole } from "../supabase/types.ts";

test("selectableIndustrySlugs = the onboarding curation ∩ the registry", () => {
  assert.deepEqual(selectableIndustrySlugs().sort(), ["clinic", "real-estate"]);
});

test("canChangeIndustry: owner + admin only", () => {
  assert.equal(canChangeIndustry("owner"), true);
  assert.equal(canChangeIndustry("admin"), true);
  for (const r of ["manager", "sales", "viewer"] as OrganizationMemberRole[]) {
    assert.equal(canChangeIndustry(r), false);
  }
});

test("owner/admin can switch to a different supported industry", () => {
  assert.deepEqual(decideIndustryChange("clinic", "real-estate", "owner"), {
    ok: true,
    action: "change",
    slug: "clinic",
  });
  assert.deepEqual(decideIndustryChange("REAL-ESTATE", "clinic", "admin"), {
    ok: true,
    action: "change",
    slug: "real-estate",
  });
});

test("same industry → a safe no-op (not an error)", () => {
  assert.deepEqual(decideIndustryChange("clinic", "clinic", "owner"), {
    ok: true,
    action: "noop",
  });
});

test("a non-owner/admin is FORBIDDEN even with a valid slug", () => {
  for (const r of ["manager", "sales", "viewer"] as OrganizationMemberRole[]) {
    assert.deepEqual(decideIndustryChange("clinic", "real-estate", r), {
      ok: false,
      reason: "forbidden",
    });
  }
});

test("an unknown / empty / non-string industry is rejected as invalid", () => {
  for (const bad of ["spaceship", "", "   ", null, 123, {}, "real estate"]) {
    assert.deepEqual(decideIndustryChange(bad, "real-estate", "owner"), {
      ok: false,
      reason: "invalid",
    });
  }
});

test("forbidden is checked BEFORE slug validity (no info leak to a viewer)", () => {
  assert.deepEqual(decideIndustryChange("spaceship", "real-estate", "viewer"), {
    ok: false,
    reason: "forbidden",
  });
});
