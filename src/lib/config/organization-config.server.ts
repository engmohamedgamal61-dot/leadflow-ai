import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getEffectiveConfig,
  enabledLeadFields,
  resolveTemplateOrGeneric,
  validateEffectiveConfig,
  type EffectiveConfig,
} from "@/lib/config";
import {
  effectiveConfigFromStored,
  parseStoredConfig,
  type StoredOrgConfig,
} from "@/lib/config/organization-config";

async function readStoredConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  organizationId: string,
): Promise<StoredOrgConfig> {
  try {
    const { data, error } = await db
      .from("organization_configs")
      .select("config")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error || !data) return {};
    return parseStoredConfig(data.config);
  } catch {
    return {};
  }
}

/**
 * Read an organization's stored overrides (RLS-scoped session client — the row
 * is only visible to its members). A missing row, an error, or Supabase not
 * being configured all yield `{}` (template-only), so the chat never breaks on
 * a config read.
 */
export async function loadStoredConfig(
  organizationId: string,
): Promise<StoredOrgConfig> {
  try {
    return await readStoredConfig(await createClient(), organizationId);
  } catch {
    return {};
  }
}

/** Merge stored overrides with the industry template, with a defensive fallback. */
function resolveEffective(
  organizationId: string,
  industryTemplateId: string,
  stored: StoredOrgConfig,
): EffectiveConfig {
  if (!resolveTemplateOrGeneric(industryTemplateId).known) {
    console.warn(
      `[config] organization ${organizationId} has an unknown industry_template_id "${industryTemplateId}"; using the neutral generic template`,
    );
  }

  const merged = effectiveConfigFromStored(organizationId, industryTemplateId, stored);
  if (
    validateEffectiveConfig(merged).valid &&
    enabledLeadFields(merged).length > 0 &&
    merged.qualificationFlow.length > 0
  ) {
    return merged;
  }

  console.error(
    `organization_configs for ${organizationId} produced an invalid EffectiveConfig; using template defaults`,
  );
  return getEffectiveConfig({ organizationId, industryTemplateId });
}

/**
 * The EffectiveConfig for an organization: its industry template merged with
 * its stored overrides. If the stored overrides somehow produce an invalid
 * config (manual DB edit, stale blob), fall back to template defaults so the
 * AI engine always has a sane configuration.
 */
export async function loadEffectiveConfig(
  organizationId: string,
  industryTemplateId: string,
): Promise<EffectiveConfig> {
  const stored = await loadStoredConfig(organizationId);
  return resolveEffective(organizationId, industryTemplateId, stored);
}

/**
 * The EffectiveConfig for an ANONYMOUS website-widget request.
 *
 * Same merge as {@link loadEffectiveConfig}, but the stored-override read goes
 * through the service-role client: the visitor has no Supabase session, so RLS
 * (defined around `auth.uid()` membership) would return nothing and the widget
 * would silently ignore the org's saved persona / qualification / scoring
 * tweaks. The organization was already resolved server-side from the trusted
 * `widget_key`, and `organization_configs.config` holds no secrets, so reading
 * it as the server here is the same trust boundary as persisting the widget's
 * leads. Never throws — a read failure degrades to template defaults.
 */
export async function loadEffectiveConfigForWidget(
  organizationId: string,
  industryTemplateId: string,
): Promise<EffectiveConfig> {
  let stored: StoredOrgConfig = {};
  try {
    stored = await readStoredConfig(createAdminClient(), organizationId);
  } catch {
    stored = {};
  }
  return resolveEffective(organizationId, industryTemplateId, stored);
}
