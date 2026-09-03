import type { IndustryTemplate } from "./types.ts";
import { realEstateTemplate } from "./templates/real-estate.ts";
import { clinicTemplate } from "./templates/clinic.ts";

/**
 * Industry template registry.
 *
 * Templates are local TypeScript objects for now. This module is the single
 * place that changes when they move to a database — every caller already goes
 * through {@link getIndustryTemplate}. Adding an industry = adding a template
 * object and one line here; no engine code changes.
 */
const TEMPLATES: Record<string, IndustryTemplate> = {
  [realEstateTemplate.slug]: realEstateTemplate,
  [clinicTemplate.slug]: clinicTemplate,
};

export const DEFAULT_INDUSTRY_SLUG = realEstateTemplate.slug;

export function getIndustryTemplate(
  slug: string,
): IndustryTemplate | undefined {
  return TEMPLATES[slug];
}

export function listIndustryTemplates(): IndustryTemplate[] {
  return Object.values(TEMPLATES);
}

export function hasIndustryTemplate(slug: string): boolean {
  return slug in TEMPLATES;
}
