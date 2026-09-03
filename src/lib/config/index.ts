import { DEFAULT_INDUSTRY_SLUG, getIndustryTemplate } from "./registry.ts";
import { resolveEffectiveConfig } from "./effective-config.ts";
import type { EffectiveConfig, OrganizationConfig } from "./types.ts";

export type * from "./types.ts";
export {
  getIndustryTemplate,
  listIndustryTemplates,
  hasIndustryTemplate,
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

/**
 * The effective configuration the AI engine runs on.
 *
 * With no organization override this is just the industry template's defaults.
 * When organization persistence lands, pass the stored {@link OrganizationConfig}
 * (loaded by whatever means) and callers stay unchanged.
 */
export function getEffectiveConfig(
  org: OrganizationConfig | null = null,
): EffectiveConfig {
  const slug = org?.industryTemplateId ?? DEFAULT_INDUSTRY_SLUG;
  const template =
    getIndustryTemplate(slug) ?? getIndustryTemplate(DEFAULT_INDUSTRY_SLUG);

  if (!template) {
    throw new Error(`No industry template found for "${slug}"`);
  }

  return resolveEffectiveConfig(template, org);
}
