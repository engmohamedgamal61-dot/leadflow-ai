import { NextResponse, type NextRequest } from "next/server";
import { requireOrganizationContext } from "@/lib/org/context";
import { canManageConfig } from "@/lib/org/roles";
import {
  exchangeCodeForTokens,
  fetchAccountEmail,
  verifyState,
} from "@/lib/calendar/google/oauth";
import { tokenEncryptionKey } from "@/lib/calendar/crypto";
import { upsertConnection } from "@/lib/calendar/connections";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/app-url";

/**
 * Google's OAuth redirect target. Verifies the signed `state` (CSRF guard,
 * 5-minute TTL, bound to the organization that started the flow), exchanges
 * the code, and stores the connection encrypted. Never renders the tokens —
 * only a `?calendar=connected|error_*` redirect back to the settings page.
 */
export async function GET(request: NextRequest) {
  const { membership } = await requireOrganizationContext();
  const settingsUrl = new URL("/dashboard/settings/integrations", request.url);
  const fail = (code: string) => {
    settingsUrl.searchParams.set("calendar", `error_${code}`);
    return NextResponse.redirect(settingsUrl);
  };

  if (!canManageConfig(membership.role)) return fail("onlyOwnerAdmin");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail("consentDenied");

  const code = params.get("code");
  const stateRaw = params.get("state");
  if (!code || !stateRaw) return fail("invalidCallback");

  let key: string;
  try {
    key = tokenEncryptionKey();
  } catch {
    return fail("notConfigured");
  }

  const statePayload = verifyState(stateRaw, key);
  if (!statePayload || statePayload.organizationId !== membership.organizationId) {
    return fail("invalidState");
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail("notConfigured");

  let redirectUri: string;
  try {
    redirectUri = `${appBaseUrl()}/api/integrations/google-calendar/callback`;
  } catch {
    return fail("notConfigured");
  }

  const exchanged = await exchangeCodeForTokens({ clientId, clientSecret, redirectUri }, code);
  if (!exchanged.ok) return fail("exchangeFailed");
  if (!exchanged.tokens.refreshToken) return fail("noRefreshToken");

  const calendarEmail = await fetchAccountEmail(exchanged.tokens.accessToken);

  const db = createAdminClient();
  const result = await upsertConnection(db, {
    organizationId: membership.organizationId,
    provider: "google",
    // The primary calendar — the org can change this later via settings once
    // a calendar picker ships; for now every connection uses the account's
    // default calendar, which is what most small teams actually want.
    calendarId: "primary",
    calendarEmail,
    timezone: "Asia/Riyadh",
    accessToken: exchanged.tokens.accessToken,
    refreshToken: exchanged.tokens.refreshToken,
    tokenExpiresAt: exchanged.tokens.expiresAt,
  });
  if (!result.ok) return fail("saveFailed");

  settingsUrl.searchParams.set("calendar", "connected");
  return NextResponse.redirect(settingsUrl);
}
