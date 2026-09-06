import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDevOrganization } from "@/lib/org/resolve";
import { getUserMembership } from "@/lib/org/membership.server";
import { resolveOrgByWidgetKey } from "@/lib/org/widget";
import { buildChatContext, type ChatContext } from "@/lib/org/chat-context";

export type { ChatContext, ChatOrganization } from "@/lib/org/chat-context";

export interface ChatContextInput {
  industryHint: string | null;
  /** Per-org website widget key, if the turn came from an embedded widget. */
  widgetKey: string | null;
}

/**
 * Resolve which organization a `/api/chat` turn belongs to.
 *
 * 1. **Authenticated** → the organization from the user's `organization_members`
 *    row (RLS-scoped; the client never supplies the id). The `industry` hint is
 *    ignored.
 * 2. **Anonymous + widget key** → the customer's own organization, resolved
 *    server-side from `organization_widget_settings` (admin client, no session)
 *    — the same trust model as the WhatsApp webhook's `phone_number_id`. The
 *    `industry` hint is ignored (the org's template wins).
 * 3. **Anonymous** → the dev/demo behavior: an `industry` hint selects one of
 *    the pre-seeded demo organizations.
 */
export async function resolveChatContext(
  input: ChatContextInput,
): Promise<ChatContext> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const membership = await getUserMembership(user.id);
      return buildChatContext({
        authenticated: true,
        membership,
        widgetOrg: null,
        demoOrg: null,
      });
    }
  } catch {
    // Auth / Supabase unavailable — fall through to the anonymous paths.
  }

  if (input.widgetKey) {
    try {
      const widgetOrg = await resolveOrgByWidgetKey(createAdminClient(), input.widgetKey);
      if (widgetOrg) {
        return buildChatContext({
          authenticated: false,
          membership: null,
          widgetOrg,
          demoOrg: null,
        });
      }
    } catch {
      // Supabase unavailable — fall through to the demo path.
    }
    // An unknown/disabled widget key: do NOT silently fall back to a demo org
    // (that would leak a stranger's chat into the demo). Config-only, no persist.
    return buildChatContext({
      authenticated: false,
      membership: null,
      widgetOrg: null,
      demoOrg: null,
    });
  }

  const demo = await resolveDevOrganization(input.industryHint);
  return buildChatContext({
    authenticated: false,
    membership: null,
    widgetOrg: null,
    demoOrg: demo
      ? {
          organizationId: demo.organizationId,
          industryTemplateId: demo.industryTemplateId,
        }
      : null,
  });
}
