import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideProxyAction,
  isPublicPath,
  isAuthEntryPath,
  LOGIN_PATH,
  APP_HOME_PATH,
} from "./route-policy.ts";

test("public paths are reachable without a session", () => {
  for (const p of [
    "/",
    "/login",
    "/signup",
    "/auth/confirm",
    "/auth/callback",
    "/api/chat",
  ]) {
    assert.equal(isPublicPath(p), true, p);
    assert.deepEqual(decideProxyAction(p, false), { type: "next" }, p);
  }
});

test("protected paths redirect anonymous users to /login", () => {
  for (const p of ["/dashboard", "/onboarding", "/dashboard/leads", "/settings"]) {
    assert.equal(isPublicPath(p), false, p);
    assert.deepEqual(decideProxyAction(p, false), {
      type: "redirect",
      to: LOGIN_PATH,
    });
  }
});

test("protected paths pass through for an authenticated user", () => {
  assert.deepEqual(decideProxyAction("/dashboard", true), { type: "next" });
  assert.deepEqual(decideProxyAction("/onboarding", true), { type: "next" });
});

test("authenticated users are bounced off the auth entry pages", () => {
  assert.equal(isAuthEntryPath("/login"), true);
  assert.equal(isAuthEntryPath("/signup"), true);
  assert.equal(isAuthEntryPath("/"), false);
  assert.deepEqual(decideProxyAction("/login", true), {
    type: "redirect",
    to: APP_HOME_PATH,
  });
  assert.deepEqual(decideProxyAction("/signup", true), {
    type: "redirect",
    to: APP_HOME_PATH,
  });
});

test("the anonymous demo chat endpoint stays public even with query params", () => {
  // route-policy only sees the pathname; a `?industry=` param cannot make an
  // authenticated request use it (that is enforced in resolveChatContext).
  assert.equal(isPublicPath("/api/chat"), true);
  assert.deepEqual(decideProxyAction("/api/chat", false), { type: "next" });
  assert.deepEqual(decideProxyAction("/api/chat", true), { type: "next" });
});
