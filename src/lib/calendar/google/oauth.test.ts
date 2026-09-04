import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchAccountEmail,
  isTokenExpiring,
  refreshAccessToken,
  signState,
  verifyState,
} from "./oauth.ts";

const KEY = "a".repeat(64);
const CONFIG = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/api/integrations/google-calendar/callback",
};

test("buildAuthUrl includes offline access, forced consent, and every scope", () => {
  const url = new URL(buildAuthUrl(CONFIG, "some-state"));
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "some-state");
  assert.match(url.searchParams.get("scope") ?? "", /calendar\.events/);
});

test("signState / verifyState round-trip and carry the organization id", () => {
  const state = signState("org-123", KEY);
  const payload = verifyState(state, KEY);
  assert.equal(payload?.organizationId, "org-123");
});

test("verifyState rejects a tampered payload or signature", () => {
  const state = signState("org-123", KEY);
  const [payloadB64, sigB64] = state.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({ organizationId: "org-EVIL", nonce: "x", exp: Date.now() + 60_000 }),
  ).toString("base64url");
  assert.equal(verifyState(`${tamperedPayload}.${sigB64}`, KEY), null);
  assert.equal(verifyState(`${payloadB64}.notarealsignature`, KEY), null);
  assert.equal(verifyState("not-even-two-parts", KEY), null);
});

test("verifyState rejects a wrong key and an expired state", () => {
  const state = signState("org-123", KEY);
  assert.equal(verifyState(state, "b".repeat(64)), null);

  const now = new Date();
  const expired = signState("org-123", KEY, new Date(now.getTime() - 10 * 60_000));
  assert.equal(verifyState(expired, KEY, now), null);
});

test("exchangeCodeForTokens / refreshAccessToken use the mock transport under CALENDAR_MOCK_TRANSPORT", async () => {
  process.env.CALENDAR_MOCK_TRANSPORT = "1";
  try {
    const exchanged = await exchangeCodeForTokens(CONFIG, "auth-code-123");
    assert.equal(exchanged.ok, true);
    if (exchanged.ok) {
      assert.ok(exchanged.tokens.accessToken);
      assert.ok(exchanged.tokens.refreshToken);
      assert.ok(Date.parse(exchanged.tokens.expiresAt) > Date.now());
    }

    const refreshed = await refreshAccessToken(CONFIG, "refresh-token-abc");
    assert.equal(refreshed.ok, true);

    const email = await fetchAccountEmail("any-token");
    assert.equal(email, "mock-calendar@example.test");
  } finally {
    delete process.env.CALENDAR_MOCK_TRANSPORT;
  }
});

test("isTokenExpiring: null/expired/near-expiry → true; comfortably future → false", () => {
  assert.equal(isTokenExpiring(null), true);
  assert.equal(isTokenExpiring("not-a-date"), true);
  const now = new Date("2026-09-04T12:00:00Z");
  assert.equal(isTokenExpiring(new Date(now.getTime() + 60_000).toISOString(), now), true);
  assert.equal(isTokenExpiring(new Date(now.getTime() + 3600_000).toISOString(), now), false);
});
