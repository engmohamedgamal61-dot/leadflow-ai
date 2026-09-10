import type { IndustryTemplate } from "./types.ts";
import { realEstateTemplate } from "./templates/real-estate.ts";
import { clinicTemplate } from "./templates/clinic.ts";
import { genericTemplate } from "./templates/generic.ts";

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

/**
 * Registry-neutral fallback. NOT in {@link TEMPLATES} — `getIndustryTemplate`
 * and `hasIndustryTemplate` still report an unknown slug as unknown, so
 * onboarding and the dashboard keep treating it as "no template configured".
 */
export { genericTemplate };
export const GENERIC_INDUSTRY_SLUG = genericTemplate.slug;

/**
 * The historical default. Kept only for callers that genuinely want the
 * real-estate template by name — it is NO LONGER the silent fallback for an
 * unknown / missing industry slug (that is {@link genericTemplate}).
 */
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

/**
 * Resolve a stored `industry_template_id` to a template the engine can run on.
 * A missing / null / unrecognised slug resolves to the NEUTRAL
 * {@link genericTemplate} (`known: false`) — never silently to real-estate.
 */
export function resolveTemplateOrGeneric(slug: string | null | undefined): {
  template: IndustryTemplate;
  known: boolean;
} {
  if (slug && slug in TEMPLATES) {
    return { template: TEMPLATES[slug], known: true };
  }
  return { template: genericTemplate, known: false };
}
