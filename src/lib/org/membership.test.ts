import { test } from "node:test";
import assert from "node:assert/strict";
import { toMembership, type MembershipJoinRow } from "./membership.ts";

const activeRow: MembershipJoinRow = {
  role: "owner",
  organizations: {
    id: "org_1",
    name: "Acme Realty",
    slug: "acme-realty-a1b2c3",
    industry_template_id: "real-estate",
    status: "active",
  },
};

test("toMembership maps an active-org row to a UserMembership", () => {
  assert.deepEqual(toMembership(activeRow), {
    organizationId: "org_1",
    organizationName: "Acme Realty",
    organizationSlug: "acme-realty-a1b2c3",
    industryTemplateId: "real-estate",
    role: "owner",
  });
});

test("toMembership returns null for no row / missing org / inactive org", () => {
  assert.equal(toMembership(null), null);
  assert.equal(toMembership(undefined), null);
  assert.equal(toMembership({ role: "owner", organizations: null }), null);
  assert.equal(
    toMembership({ ...activeRow, organizations: { ...activeRow.organizations!, status: "suspended" } }),
    null,
  );
});

test("toMembership preserves a non-owner role", () => {
  assert.equal(toMembership({ ...activeRow, role: "sales" })?.role, "sales");
});
