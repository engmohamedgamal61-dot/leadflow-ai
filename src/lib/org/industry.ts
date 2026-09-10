/**
 * Pure decision logic for changing an organization's industry template.
 *
 * `organizations.industry_template_id` is the canonical source of truth. This
 * module only decides whether a requested change is allowed and what it means;
 * `industry-actions.ts` performs it through the trusted DB path.
 */

import type { OrganizationMemberRole } from "@/lib/supabase/types";
// Relative value import so this module + its tests run under `node --test`.
import { hasIndustryTemplate } from "../config/registry.ts";
import { ONBOARDING_INDUSTRY_SLUGS } from "./onboarding-industries.ts";

/** Roles allowed to change the organization industry — the same bar as AI config. */
const CAN_CHANGE_INDUSTRY: ReadonlySet<OrganizationMemberRole> = new Set([
  "owner",
  "admin",
]);

export function canChangeIndustry(role: OrganizationMemberRole): boolean {
  return CAN_CHANGE_INDUSTRY.has(role);
}

/** Industry slugs a change may target — the onboarding curation ∩ the registry. */
export function selectableIndustrySlugs(): string[] {
  return ONBOARDING_INDUSTRY_SLUGS.filter(hasIndustryTemplate);
}

export type IndustryChangeDecision =
  | { ok: true; action: "noop" }
  | { ok: true; action: "change"; slug: string }
  | { ok: false; reason: "forbidden" | "invalid" };

/**
 * @param requested   the slug the client asked for (untrusted)
 * @param current     the org's current `industry_template_id`
 * @param role        the caller's membership role
 */
export function decideIndustryChange(
  requested: unknown,
  current: string,
  role: OrganizationMemberRole,
): IndustryChangeDecision {
  if (!canChangeIndustry(role)) return { ok: false, reason: "forbidden" };

  const slug = typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (!slug || !selectableIndustrySlugs().includes(slug)) {
    return { ok: false, reason: "invalid" };
  }
  if (slug === current) return { ok: true, action: "noop" };
  return { ok: true, action: "change", slug };
}
