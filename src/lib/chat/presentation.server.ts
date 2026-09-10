/**
 * Server-only: resolve the customer-chat presentation for the current request.
 *
 * The organization is determined ONLY through the trusted tenant-resolution
 * flow (`resolveChatContext`): an authenticated member's `organization_members`
 * row (RLS-scoped), or a server-side widget-key lookup, or the dev demo org.
 * A client-supplied organization id is never consulted. If nothing resolves
 * (no session, no widget key, no demo), the NEUTRAL generic presentation is
 * returned — never another industry's copy.
 */

import "server-only";

import { getDictionary } from "@/i18n/server";
import { hasIndustryTemplate } from "@/lib/config";
import {
  resolveChatContext,
  type ChatContextInput,
} from "@/lib/org/chat-organization";
import {
  genericChatPresentation,
  resolveChatPresentation,
  type ChatPresentation,
} from "@/lib/chat/presentation";

export interface LoadedChatPresentation {
  presentation: ChatPresentation;
  /** The resolved organization id, or `null` (config-only / generic). */
  organizationId: string | null;
  /** widget-key path only: the embedding origin is not on the org's allowlist → the page must 404. */
  blocked: boolean;
}

/**
 * `input` mirrors `resolveChatContext`'s: `industryHint` (dev demo switch only),
 * `widgetKey` + `widgetOrigin` (embedded widget). The root page passes just the
 * industry hint; the embed page passes the key + origin.
 */
export async function loadChatPresentation(
  input: ChatContextInput,
): Promise<LoadedChatPresentation> {
  const dict = await getDictionary();

  let ctx: Awaited<ReturnType<typeof resolveChatContext>>;
  try {
    ctx = await resolveChatContext(input);
  } catch {
    return {
      presentation: genericChatPresentation(dict),
      organizationId: null,
      blocked: false,
    };
  }

  if (ctx.widgetOriginBlocked) {
    return {
      presentation: genericChatPresentation(dict),
      organizationId: null,
      blocked: true,
    };
  }

  const org = ctx.organization;
  if (org?.industryTemplateId && !hasIndustryTemplate(org.industryTemplateId)) {
    // Same neutral degradation as the AI config path — surfaced so it can be fixed.
    console.warn(
      `[chat] organization ${org.organizationId} has an unknown industry_template_id "${org.industryTemplateId}"; showing the neutral generic chat`,
    );
  }
  return {
    presentation: resolveChatPresentation({
      industrySlug: org?.industryTemplateId ?? null,
      businessName: org?.organizationName ?? null,
      dict,
    }),
    organizationId: org?.organizationId ?? null,
    blocked: false,
  };
}
