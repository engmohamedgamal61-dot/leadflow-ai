/**
 * Google OAuth2 (authorization-code + refresh) — isolated so no other module
 * knows Google's endpoints/scopes. `CALENDAR_MOCK_TRANSPORT=1` swaps the
 * network calls for canned responses (local dev / E2E without a real Google
 * Cloud OAuth client), mirroring `whatsapp/meta-client.ts`.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Least privilege: create/modify events, check free/busy, read the connected email. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent", // guarantees a refresh_token even on a re-consent
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// ── signed `state` (CSRF protection for the OAuth round trip) ──────────────

export interface OAuthStatePayload {
  organizationId: string;
  nonce: string;
  /** Unix ms expiry. */
  exp: number;
}

const STATE_TTL_MS = 5 * 60_000;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signState(
  organizationId: string,
  hexKey: string,
  now: Date = new Date(),
): string {
  const payload: OAuthStatePayload = {
    organizationId,
    nonce: randomBytes(9).toString("base64url"),
    exp: now.getTime() + STATE_TTL_MS,
  };
  const json = JSON.stringify(payload);
  const sig = createHmac("sha256", Buffer.from(hexKey, "hex"))
    .update(json)
    .digest();
  return `${b64url(json)}.${b64url(sig)}`;
}

/** Verify signature + expiry. Never throws. */
export function verifyState(
  state: string,
  hexKey: string,
  now: Date = new Date(),
): OAuthStatePayload | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let json: string;
  try {
    json = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedSig = createHmac("sha256", Buffer.from(hexKey, "hex"))
    .update(json)
    .digest();
  let givenSig: Buffer;
  try {
    givenSig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (
    givenSig.length !== expectedSig.length ||
    !timingSafeEqual(givenSig, expectedSig)
  ) {
    return null;
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(json) as OAuthStatePayload;
  } catch {
    return null;
  }
  if (typeof payload.organizationId !== "string" || !payload.organizationId) {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < now.getTime()) {
    return null;
  }
  return payload;
}

// ── token exchange / refresh ────────────────────────────────────────────────

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ISO timestamp. */
  expiresAt: string;
}

function isMock(): boolean {
  return process.env.CALENDAR_MOCK_TRANSPORT === "1";
}

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postToken(
  body: URLSearchParams,
): Promise<{ ok: true; json: TokenResponseBody } | { ok: false; detail: string }> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as TokenResponseBody;
    if (!res.ok) {
      return { ok: false, detail: (json.error_description ?? json.error ?? `HTTP ${res.status}`).slice(0, 200) };
    }
    return { ok: true, json };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 200) : "network error",
    };
  }
}

export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string,
): Promise<{ ok: true; tokens: GoogleTokens } | { ok: false; detail: string }> {
  if (isMock()) {
    return {
      ok: true,
      tokens: {
        accessToken: `mock-access-${code.slice(0, 8)}`,
        refreshToken: `mock-refresh-${code.slice(0, 8)}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    };
  }

  const result = await postToken(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  );
  if (!result.ok) return result;
  if (!result.json.access_token) {
    return { ok: false, detail: "no access_token in response" };
  }
  return {
    ok: true,
    tokens: {
      accessToken: result.json.access_token,
      refreshToken: result.json.refresh_token ?? null,
      expiresAt: new Date(
        Date.now() + (result.json.expires_in ?? 3600) * 1000,
      ).toISOString(),
    },
  };
}

export async function refreshAccessToken(
  config: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">,
  refreshToken: string,
): Promise<{ ok: true; accessToken: string; expiresAt: string } | { ok: false; detail: string }> {
  if (isMock()) {
    return {
      ok: true,
      accessToken: `mock-access-refreshed-${refreshToken.slice(0, 8)}`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
  }

  const result = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  );
  if (!result.ok) return result;
  if (!result.json.access_token) {
    return { ok: false, detail: "no access_token in refresh response" };
  }
  return {
    ok: true,
    accessToken: result.json.access_token,
    expiresAt: new Date(Date.now() + (result.json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  if (isMock()) return "mock-calendar@example.test";
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

/** True when the token expires within the next 2 minutes (refresh margin). */
export function isTokenExpiring(
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t - now.getTime() < 2 * 60_000;
}
