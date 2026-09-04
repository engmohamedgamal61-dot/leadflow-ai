import { NextResponse, type NextRequest } from "next/server";
import { requireOrganizationContext } from "@/lib/org/context";
import { canManageConfig } from "@/lib/org/roles";
import { buildAuthUrl, signState } from "@/lib/calendar/google/oauth";
import { tokenEncryptionKey } from "@/lib/calendar/crypto";
import { appBaseUrl } from "@/lib/app-url";

/**
 * Starts the Google Calendar OAuth consent flow for the caller's
 * organization. Requires an authenticated session (the proxy already gates
 * this — it isn't a public path) AND owner/admin — a connection holds
 * credentials, same bar as every other integration.
 */
export async function GET(request: NextRequest) {
  const { membership } = await requireOrganizationContext();
  const settingsUrl = new URL("/dashboard/settings/integrations", request.url);

  if (!canManageConfig(membership.role)) {
    settingsUrl.searchParams.set("calendar", "error_onlyOwnerAdmin");
    return NextResponse.redirect(settingsUrl);
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  let key: string;
  try {
    key = tokenEncryptionKey();
  } catch {
    settingsUrl.searchParams.set("calendar", "error_notConfigured");
    return NextResponse.redirect(settingsUrl);
  }
  if (!clientId || !clientSecret) {
    settingsUrl.searchParams.set("calendar", "error_notConfigured");
    return NextResponse.redirect(settingsUrl);
  }

  let redirectUri: string;
  try {
    redirectUri = `${appBaseUrl()}/api/integrations/google-calendar/callback`;
  } catch {
    settingsUrl.searchParams.set("calendar", "error_notConfigured");
    return NextResponse.redirect(settingsUrl);
  }

  const state = signState(membership.organizationId, key);
  const consentUrl = buildAuthUrl({ clientId, clientSecret, redirectUri }, state);
  return NextResponse.redirect(consentUrl);
}
