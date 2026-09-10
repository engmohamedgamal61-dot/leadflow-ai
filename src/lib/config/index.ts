import { resolveTemplateOrGeneric } from "./registry.ts";
import { resolveEffectiveConfig } from "./effective-config.ts";
import type { EffectiveConfig, OrganizationConfig } from "./types.ts";

export type * from "./types.ts";
export {
  getIndustryTemplate,
  listIndustryTemplates,
  hasIndustryTemplate,
  resolveTemplateOrGeneric,
  genericTemplate,
  GENERIC_INDUSTRY_SLUG,
  DEFAULT_INDUSTRY_SLUG,
} from "./registry.ts";
export {
  resolveEffectiveConfig,
  enabledLeadFields,
} from "./effective-config.ts";
export {
  validateIndustryTemplate,
  validateEffectiveConfig,
  type ValidationResult,
} from "./validate.ts";
export {
  parseStoredConfig,
  validateStoredConfig,
  toOrganizationConfig,
  effectiveConfigFromStored,
  compactStoredConfig,
  diffAiBehavior,
  diffQualification,
  diffScoringThresholds,
  LIMITS as ORG_CONFIG_LIMITS,
  type StoredOrgConfig,
  type AiBehaviorForm,
  type FieldForm,
} from "./organization-config.ts";

/**
 * The effective configuration the AI engine runs on.
 *
 * With no organization, or an organization whose `industryTemplateId` is not a
 * known template, this resolves to the NEUTRAL {@link genericTemplate} — never
 * silently to real-estate. When organization persistence lands, pass the stored
 * {@link OrganizationConfig} and callers stay unchanged.
 */
export function getEffectiveConfig(
  org: OrganizationConfig | null = null,
): EffectiveConfig {
  const { template } = resolveTemplateOrGeneric(org?.industryTemplateId);
  return resolveEffectiveConfig(template, org);
}
