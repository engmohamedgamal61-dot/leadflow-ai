import type { UserMembership } from "@/lib/org/membership";

export interface ChatOrganization {
  organizationId: string;
  industryTemplateId: string;
  /** How the organization was resolved. */
  source: "member" | "dev-demo";
}

export interface ChatContext {
  /** The organization to persist against, or `null` (config-only chat). */
  organization: ChatOrganization | null;
  /**
   * Whether the client's `industry` hint may influence the effective config.
   * `true` only for the anonymous demo path — an authenticated user's industry
   * always comes from their organization's template and can never be
   * overridden by a query/body parameter.
   */
  industryHintAllowed: boolean;
}

export interface DemoOrg {
  organizationId: string;
  industryTemplateId: string;
}

/**
 * Pure decision: given the request's auth state, the caller's membership (if
 * authenticated) and the resolved demo org (if anonymous), produce the chat
 * context.
 *
 * The one rule that matters for security: `industryHintAllowed` is `true` ONLY
 * for anonymous requests. An authenticated user's organization and industry
 * always come from their membership — the `industry` param is inert, and a
 * client-supplied organization id is never consulted anywhere.
 */
export function buildChatContext(input: {
  authenticated: boolean;
  membership:
    | Pick<UserMembership, "organizationId" | "industryTemplateId">
    | null;
  demoOrg: DemoOrg | null;
}): ChatContext {
  if (input.authenticated) {
    return {
      organization: input.membership
        ? {
            organizationId: input.membership.organizationId,
            industryTemplateId: input.membership.industryTemplateId,
            source: "member",
          }
        : null,
      industryHintAllowed: false,
    };
  }

  return {
    organization: input.demoOrg
      ? {
          organizationId: input.demoOrg.organizationId,
          industryTemplateId: input.demoOrg.industryTemplateId,
          source: "dev-demo",
        }
      : null,
    industryHintAllowed: true,
  };
}
