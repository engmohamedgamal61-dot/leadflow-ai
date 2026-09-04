/**
 * Industry templates offered during onboarding, in display order.
 *
 * This is a UI/product curation of the template *registry* (`@/lib/config`) —
 * not industry behaviour. The AI engine still resolves everything from the
 * stored `industry_template_id` via the registry; this list only controls
 * which of the registered templates a new organization may start from.
 */
export const ONBOARDING_INDUSTRY_SLUGS = ["real-estate", "clinic"] as const;

export type OnboardingIndustrySlug = (typeof ONBOARDING_INDUSTRY_SLUGS)[number];
