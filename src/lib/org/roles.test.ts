import { test } from "node:test";
import assert from "node:assert/strict";
import { canWriteLeads, canManageLeads } from "./roles.ts";

test("canWriteLeads mirrors the leads write RLS policy", () => {
  for (const role of ["owner", "admin", "manager", "sales"]) {
    assert.equal(canWriteLeads(role), true, role);
  }
  assert.equal(canWriteLeads("viewer"), false);
  assert.equal(canWriteLeads("nonsense"), false);
});

test("canManageLeads excludes sales and viewer", () => {
  assert.equal(canManageLeads("owner"), true);
  assert.equal(canManageLeads("admin"), true);
  assert.equal(canManageLeads("manager"), true);
  assert.equal(canManageLeads("sales"), false);
  assert.equal(canManageLeads("viewer"), false);
});
