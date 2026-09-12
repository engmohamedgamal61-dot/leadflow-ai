/**
 * Per-organization website widget — the public lead-intake path.
 *
 * A `widget_key` (UUID, in `organization_widget_settings`) is embedded in the
 * customer's own site. `/api/chat` resolves the organization from it exactly
 * the way the WhatsApp webhook resolves an org from `phone_number_id`:
 * server-side, via the admin client, with no session and nothing the browser
 * can widen. Tenant isolation is still RLS; the key is a routing identifier,
 * not a secret.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WidgetSettingsView {
  widgetKey: string;
  enabled: boolean;
  allowedOrigins: string[];
}

export interface ResolvedWidgetOrg {
  organizationId: string;
  organizationName: string;
  industryTemplateId: string;
  /** Origins the organization has authorized to embed this widget. */
  allowedOrigins: string[];
}

/** Normalize an origin list from a textarea: one per line, `scheme://host[:port]`, deduped. */
export function parseAllowedOrigins(raw: unknown): { ok: boolean; origins: string[]; invalid: string[] } {
  const lines = String(raw ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const line of lines) {
    try {
      const u = new URL(line);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        invalid.push(line);
        continue;
      }
      const normalized = u.origin;
      if (!origins.includes(normalized)) origins.push(normalized);
    } catch {
      invalid.push(line);
    }
  }
  return { ok: invalid.length === 0, origins: origins.slice(0, 20), invalid };
}

function toView(data: {
  widget_key: string;
  enabled: boolean;
  allowed_origins: string[] | null;
}): WidgetSettingsView {
  return {
    widgetKey: data.widget_key,
    enabled: data.enabled,
    allowedOrigins: data.allowed_origins ?? [],
  };
}

/** Dashboard read (RLS session client). `null` when the row doesn't exist yet. */
export async function getWidgetSettings(
  db: Db,
  organizationId: string,
): Promise<WidgetSettingsView | null> {
  const { data } = await db
    .from("organization_widget_settings")
    .select("widget_key, enabled, allowed_origins")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data ? toView(data) : null;
}

/**
 * Get the widget settings, creating a disabled row (with a fresh key) on first
 * use. Session client — the RLS insert policy is owner/admin.
 */
export async function ensureWidgetSettings(
  db: Db,
  organizationId: string,
): Promise<WidgetSettingsView | null> {
  const existing = await getWidgetSettings(db, organizationId);
  if (existing) return existing;

  const { data, error } = await db
    .from("organization_widget_settings")
    .insert({ organization_id: organizationId })
    .select("widget_key, enabled, allowed_origins")
    .maybeSingle();
  if (error || !data) {
    // Lost a create race, or not permitted — re-read.
    return getWidgetSettings(db, organizationId);
  }
  return toView(data);
}

/** Session client — RLS update policy is owner/admin. */
export async function updateWidgetSettings(
  db: Db,
  organizationId: string,
  patch: Partial<{ enabled: boolean; widget_key: string; allowed_origins: string[] }>,
): Promise<boolean> {
  const { error } = await db
    .from("organization_widget_settings")
    .update(patch)
    .eq("organization_id", organizationId);
  return !error;
}

/**
 * Thrown when the widget lookup query itself fails (Supabase/network
 * unreachable) — distinct from a normal "no such key" result, so a caller
 * can tell an outage apart from a stranger hitting chat with a bogus key.
 * See `chat-organization.ts`'s catch block, which is the only place this is
 * caught, and docs on the Supabase-outage hardening work.
 */
export class WidgetLookupError extends Error {
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super("widget lookup failed");
    this.name = "WidgetLookupError";
    this.cause = cause;
  }
}

/**
 * Anonymous resolution for `/api/chat` — admin client, no session. Returns
 * `null` for an unknown key, a disabled widget, a non-UUID, or a suspended
 * organization. Throws {@link WidgetLookupError} if the query itself failed
 * (e.g. Supabase unreachable) — never conflated with a legitimate "not found".
 */
export async function resolveOrgByWidgetKey(
  db: Db,
  widgetKey: string,
): Promise<ResolvedWidgetOrg | null> {
  if (!UUID_RE.test(widgetKey)) return null;
  const { data, error } = await db
    .from("organization_widget_settings")
    .select("enabled, allowed_origins, organizations ( id, name, industry_template_id, status )")
    .eq("widget_key", widgetKey)
    .maybeSingle();
  if (error) throw new WidgetLookupError(error);
  if (!data || !data.enabled) return null;
  const org = (data as {
    organizations?: {
      id: string;
      name: string;
      industry_template_id: string;
      status: string;
    } | null;
  }).organizations;
  if (!org || org.status !== "active") return null;
  return {
    organizationId: org.id,
    organizationName: org.name,
    industryTemplateId: org.industry_template_id,
    allowedOrigins:
      (data as { allowed_origins?: string[] | null }).allowed_origins ?? [],
  };
}
