import { createClient } from "@/lib/supabase/server";
import {
  getEffectiveConfig,
  enabledLeadFields,
  validateEffectiveConfig,
  type EffectiveConfig,
} from "@/lib/config";
import {
  effectiveConfigFromStored,
  parseStoredConfig,
  type StoredOrgConfig,
} from "@/lib/config/organization-config";

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
    const supabase = await createClient();
    const { data, error } = await supabase
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
  const merged = effectiveConfigFromStored(
    organizationId,
    industryTemplateId,
    stored,
  );

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
