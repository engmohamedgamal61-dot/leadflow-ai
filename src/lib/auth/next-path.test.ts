import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "./next-path.ts";

const FB = "/dashboard";

test("keeps a legitimate local path", () => {
  assert.equal(safeNextPath("/dashboard/leads", FB), "/dashboard/leads");
  assert.equal(safeNextPath("/invite/abc-123", FB), "/invite/abc-123");
  assert.equal(safeNextPath("/dashboard/leads?status=qualified", FB), "/dashboard/leads?status=qualified");
});

test("rejects open-redirect / host-swap attempts", () => {
  for (const evil of [
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http://evil.com",
    "/\tevil",
    "/\nSet-Cookie: x=y",
    "/\r\nLocation: https://evil.com",
    "/ /evil", // leading space after slash
    " //evil.com",
    "/https:/evil.com",
    "/\\/evil.com",
    "javascript:alert(1)",
    "/javascript:alert(1)",
  ]) {
    assert.equal(safeNextPath(evil, FB), FB, `should reject ${JSON.stringify(evil)}`);
  }
});

test("rejects non-string / absent / oversized input", () => {
  assert.equal(safeNextPath(undefined, FB), FB);
  assert.equal(safeNextPath(null, FB), FB);
  assert.equal(safeNextPath(42, FB), FB);
  assert.equal(safeNextPath("", FB), FB);
  assert.equal(safeNextPath("/" + "a".repeat(600), FB), FB);
  assert.equal(safeNextPath("relative/no/slash", FB), FB);
});
