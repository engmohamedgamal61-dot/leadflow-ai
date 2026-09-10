import type { UserMembership } from "@/lib/org/membership";

export interface ChatOrganization {
  organizationId: string;
  /** The organization's display name — used for the customer chat's branding. */
  organizationName: string | null;
  industryTemplateId: string;
  /** How the organization was resolved. */
  source: "member" | "widget" | "dev-demo";
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
  /**
   * Set when a widget key resolved to a real organization but the request's
   * embedding origin is not on that organization's allowlist. The caller must
   * reject the request (403) — it never falls through to the demo org.
   */
  widgetOriginBlocked?: boolean;
}

export interface DemoOrg {
  organizationId: string;
  organizationName?: string | null;
  industryTemplateId: string;
}

/**
 * Pure decision: given the request's auth state, the caller's membership (if
 * authenticated) and the resolved demo org (if anonymous), produce the chat
 * context.
 *
 * The one rule that matters for security: `industryHintAllowed` is `true` ONLY
 * when a dev/demo organization actually resolved (anonymous, no widget key,
 * demo chat enabled). An authenticated user, a widget request, and a production
 * anonymous request with no demo org all get `false` — the `industry` param is
 * inert and a client-supplied organization id is never consulted anywhere.
 */
export function buildChatContext(input: {
  authenticated: boolean;
  membership:
    | Pick<
        UserMembership,
        "organizationId" | "organizationName" | "industryTemplateId"
      >
    | null;
  /** Resolved from a per-org website widget key (anonymous, but a real tenant). */
  widgetOrg: DemoOrg | null;
  demoOrg: DemoOrg | null;
}): ChatContext {
  if (input.authenticated) {
    return {
      organization: input.membership
        ? {
            organizationId: input.membership.organizationId,
            organizationName: input.membership.organizationName || null,
            industryTemplateId: input.membership.industryTemplateId,
            source: "member",
          }
        : null,
      industryHintAllowed: false,
    };
  }

  // A widget key identifies a real customer org — the industry hint is inert
  // here too (the org's template wins), exactly like the authenticated path.
  if (input.widgetOrg) {
    return {
      organization: {
        organizationId: input.widgetOrg.organizationId,
        organizationName: input.widgetOrg.organizationName || null,
        industryTemplateId: input.widgetOrg.industryTemplateId,
        source: "widget",
      },
      industryHintAllowed: false,
    };
  }

  // Anonymous, no widget key. The `industry` hint may influence the effective
  // config ONLY when a dev/demo org actually resolved from it — otherwise (e.g.
  // production, where `resolveDevOrganization` returns null) there is no org,
  // nothing is persisted, and `?industry=` must not switch the AI's behaviour.
  return {
    organization: input.demoOrg
      ? {
          organizationId: input.demoOrg.organizationId,
          organizationName: input.demoOrg.organizationName || null,
          industryTemplateId: input.demoOrg.industryTemplateId,
          source: "dev-demo",
        }
      : null,
    industryHintAllowed: input.demoOrg !== null,
  };
}
