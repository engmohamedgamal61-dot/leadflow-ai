/**
 * Calendar connection resolution — the trusted-server layer between the
 * `organization_calendar_connections` row and the generic `CalendarProvider`.
 * Mirrors `whatsapp/connections.ts`: dashboard reads never select the tokens;
 * only the trusted server boundary (AI executor, manual booking actions,
 * OAuth callback) decrypts them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { CalendarConnectionRecord, CalendarProviderId } from "./provider.ts";
import { decryptToken, encryptToken, tokenEncryptionKey } from "./crypto.ts";
import { parseCalendarSettings, type CalendarSettings } from "./config.ts";

type Db = SupabaseClient<Database>;

export interface CalendarConnectionView {
  id: string;
  provider: CalendarProviderId;
  status: "pending" | "connected" | "disconnected" | "error";
  calendarId: string | null;
  calendarEmail: string | null;
  timezone: string;
  lastError: string | null;
  settings: CalendarSettings;
  updatedAt: string;
}

/** Dashboard-safe read — never selects the encrypted tokens. */
export async function getConnectionView(
  db: Db,
  organizationId: string,
): Promise<CalendarConnectionView | null> {
  const { data, error } = await db
    .from("organization_calendar_connections")
    .select(
      "id, provider, status, calendar_id, calendar_email, timezone, last_error, settings, updated_at",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    provider: data.provider as CalendarProviderId,
    status: data.status as CalendarConnectionView["status"],
    calendarId: data.calendar_id,
    calendarEmail: data.calendar_email,
    timezone: data.timezone,
    lastError: data.last_error,
    settings: parseCalendarSettings(data.settings),
    updatedAt: data.updated_at,
  };
}

/**
 * Resolve a connected calendar with decrypted tokens — trusted server
 * boundary only (never returned to the browser). `null` when there is no
 * `connected` connection or the token can't be decrypted.
 */
export async function resolveCalendarConnection(
  db: Db,
  organizationId: string,
): Promise<CalendarConnectionRecord | null> {
  const { data, error } = await db
    .from("organization_calendar_connections")
    .select(
      "id, organization_id, provider, status, calendar_id, calendar_email, timezone, access_token_encrypted, refresh_token_encrypted, token_expires_at, settings",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== "connected" || !data.access_token_encrypted || !data.refresh_token_encrypted) {
    return null;
  }

  try {
    const key = tokenEncryptionKey();
    return {
      id: data.id,
      organizationId: data.organization_id,
      provider: data.provider as CalendarProviderId,
      status: data.status as CalendarConnectionRecord["status"],
      calendarId: data.calendar_id,
      calendarEmail: data.calendar_email,
      timezone: data.timezone,
      accessToken: decryptToken(data.access_token_encrypted, key),
      refreshToken: decryptToken(data.refresh_token_encrypted, key),
      tokenExpiresAt: data.token_expires_at,
      settings: parseCalendarSettings(data.settings),
    };
  } catch (e) {
    console.error(`calendar: token decrypt failed for org ${organizationId}:`, e instanceof Error ? e.message : "error");
    return null;
  }
}

/** Persist a refreshed access token (called after `provider.ensureFreshToken`). */
export async function persistRefreshedToken(
  db: Db,
  connectionId: string,
  accessToken: string,
  expiresAt: string | null,
): Promise<void> {
  const key = tokenEncryptionKey();
  await db
    .from("organization_calendar_connections")
    .update({
      access_token_encrypted: encryptToken(accessToken, key),
      token_expires_at: expiresAt,
    })
    .eq("id", connectionId);
}

export interface UpsertConnectionInput {
  organizationId: string;
  provider: CalendarProviderId;
  calendarId: string;
  calendarEmail: string | null;
  timezone: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
}

/** Store a newly-authorized connection (OAuth callback). */
export async function upsertConnection(
  db: Db,
  input: UpsertConnectionInput,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const key = tokenEncryptionKey();
  const { error } = await db.from("organization_calendar_connections").upsert(
    {
      organization_id: input.organizationId,
      provider: input.provider,
      calendar_id: input.calendarId,
      calendar_email: input.calendarEmail,
      timezone: input.timezone,
      access_token_encrypted: encryptToken(input.accessToken, key),
      refresh_token_encrypted: encryptToken(input.refreshToken, key),
      token_expires_at: input.tokenExpiresAt,
      status: "connected",
      last_error: null,
    },
    { onConflict: "organization_id" },
  );
  if (error) return { ok: false, detail: error.message.slice(0, 200) };
  return { ok: true };
}
