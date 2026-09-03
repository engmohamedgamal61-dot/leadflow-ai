import { createAdminClient } from "@/lib/supabase/admin";

export interface ResolvedOrganization {
  organizationId: string;
  industryTemplateId: string;
  /** How the organization was resolved. Only "dev-demo" until Auth lands. */
  source: "dev-demo";
}

const DEV_ORG_SLUG_DEFAULT = "demo-real-estate";
const DEV_ORG_SLUG_CLINIC = "demo-clinic";

/**
 * DEV / DEMO organization resolution.
 *
 * Production will resolve the organization from the authenticated user's
 * membership:
 *
 *   authenticated user → organization_members → organization
 *                      → industry_template_id → EffectiveConfig
 *
 * Until authentication exists, a dev `industry` hint selects one of two
 * pre-seeded demo organizations. This is **not authorization**: the hint only
 * chooses among demo orgs the server controls, every organization's rows stay
 * RLS-isolated for its real members, and an anonymous prospect can never read
 * another org's data.
 *
 * Returns `null` when Supabase is not configured or the demo organization is
 * missing — the chat then runs config-only with no persistence (unchanged dev
 * behaviour).
 */
export async function resolveDevOrganization(
  industryHint: string | null,
): Promise<ResolvedOrganization | null> {
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
      .select("id, industry_template_id, status")
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
