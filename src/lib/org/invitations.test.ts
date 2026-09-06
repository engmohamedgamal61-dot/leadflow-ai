import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVITABLE_ROLES,
  isInvitableRole,
  generateInviteToken,
  hashInviteToken,
  inviteLink,
  invitationStatus,
  coerceInvitableRole,
} from "./invitations.ts";

test("INVITABLE_ROLES never includes owner", () => {
  assert.deepEqual([...INVITABLE_ROLES], ["admin", "manager", "sales", "viewer"]);
  assert.equal(isInvitableRole("owner"), false);
  assert.equal(isInvitableRole("admin"), true);
  assert.equal(isInvitableRole("nonsense"), false);
  assert.equal(coerceInvitableRole("owner"), null);
  assert.equal(coerceInvitableRole("manager"), "manager");
});

test("token: high entropy, and the same raw token always hashes the same", () => {
  const a = generateInviteToken();
  const b = generateInviteToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
  assert.match(a, /^[A-Za-z0-9_-]+$/); // base64url
  assert.equal(hashInviteToken(a), hashInviteToken(a));
  assert.notEqual(hashInviteToken(a), hashInviteToken(b));
  assert.match(hashInviteToken(a), /^[0-9a-f]{64}$/);
});

test("inviteLink builds a clean /invite/<token> URL", () => {
  assert.equal(inviteLink("https://app.example.com/", "abc"), "https://app.example.com/invite/abc");
});

test("invitationStatus: pending / expired / accepted", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const future = new Date(now.getTime() + 3_600_000).toISOString();
  const past = new Date(now.getTime() - 3_600_000).toISOString();
  assert.equal(invitationStatus({ accepted_at: null, expires_at: future }, now), "pending");
  assert.equal(invitationStatus({ accepted_at: null, expires_at: past }, now), "expired");
  assert.equal(invitationStatus({ accepted_at: past, expires_at: future }, now), "accepted");
});
