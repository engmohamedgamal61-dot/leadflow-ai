// Relative so this module + its test load under `node --test`.
import { createAdminClient } from "../supabase/admin.ts";

export interface ResolvedOrganization {
  organizationId: string;
  industryTemplateId: string;
  /** How the organization was resolved. Only "dev-demo" until Auth lands. */
  source: "dev-demo";
}

const DEV_ORG_SLUG_DEFAULT = "demo-real-estate";
const DEV_ORG_SLUG_CLINIC = "demo-clinic";

/**
 * Is the anonymous demo-chat path enabled?
 *
 * OFF by default. It is only ON when `LEADFLOW_ENABLE_DEMO_CHAT=1` AND the
 * process is not running in production — production must NEVER silently
 * persist an anonymous chat into a seeded demo org (a real customer's leads
 * would land in a shared bucket). A production deployment that genuinely wants
 * the marketing demo must set `LEADFLOW_ENABLE_DEMO_CHAT=1` *and*
 * `NODE_ENV !== "production"` is not possible, so it must accept the documented
 * risk explicitly via `LEADFLOW_FORCE_DEMO_CHAT=1`.
 */
export function demoChatEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.LEADFLOW_ENABLE_DEMO_CHAT !== "1") return false;
  if (env.NODE_ENV === "production" && env.LEADFLOW_FORCE_DEMO_CHAT !== "1") {
    return false;
  }
  return true;
}

/**
 * DEV / DEMO organization resolution.
 *
 * A dev `industry` hint selects one of two pre-seeded demo organizations for
 * anonymous chat persistence. This is **not authorization** — the hint only
 * chooses among demo orgs the server controls, and every org's rows stay
 * RLS-isolated. It is **disabled in production** (see {@link demoChatEnabled}):
 * production always returns `null` → the chat runs config-only with NO
 * persistence, so an anonymous lead can never be written to a demo tenant.
 *
 * Also returns `null` when Supabase is not configured, the demo org is
 * missing / not active, or (defence in depth) the resolved org's slug isn't a
 * `demo-` slug.
 */
export async function resolveDevOrganization(
  industryHint: string | null,
): Promise<ResolvedOrganization | null> {
  if (!demoChatEnabled()) return null;

  const slug =
    industryHint === "clinic"
      ? process.env.LEADFLOW_DEV_ORG_SLUG_CLINIC ?? DEV_ORG_SLUG_CLINIC
      : process.env.LEADFLOW_DEV_ORG_SLUG ?? DEV_ORG_SLUG_DEFAULT;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return null; // Supabase env not set — running without a database.
  }

  try {
    const { data, error } = await admin
      .from("organizations")
      .select("id, slug, industry_template_id, status")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      // A real database/network error (not just "not found") — worth a log.
      console.error(
        `organization resolution query failed for slug "${slug}":`,
        error,
      );
      return null;
    }
    if (!data || data.status !== "active") return null;
    // Belt-and-braces: only ever persist an anonymous chat into a demo org.
    if (!/^demo-/.test(data.slug ?? "")) return null;

    return {
      organizationId: data.id,
      industryTemplateId: data.industry_template_id,
      source: "dev-demo",
    };
  } catch (error) {
    console.error(`organization resolution failed for slug "${slug}":`, error);
    return null;
  }
}
