import { createClient } from "@/lib/supabase/server";
import { resolveDevOrganization } from "@/lib/org/resolve";
import { getUserMembership } from "@/lib/org/membership.server";
import { buildChatContext, type ChatContext } from "@/lib/org/chat-context";

export type { ChatContext, ChatOrganization } from "@/lib/org/chat-context";

/**
 * Resolve which organization a `/api/chat` turn belongs to.
 *
 * 1. **Authenticated** → the organization from the user's `organization_members`
 *    row (RLS-scoped; the client never supplies the id). The `industry` hint is
 *    ignored.
 * 2. **Anonymous** → the existing dev/demo behavior: an `industry` hint selects
 *    one of the pre-seeded demo organizations. Unchanged from Phase B.
 */
export async function resolveChatContext(
  industryHint: string | null,
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
        demoOrg: null,
      });
    }
  } catch {
    // Auth / Supabase unavailable — fall through to the anonymous demo path.
  }

  const demo = await resolveDevOrganization(industryHint);
  return buildChatContext({
    authenticated: false,
    membership: null,
    demoOrg: demo
      ? {
          organizationId: demo.organizationId,
          industryTemplateId: demo.industryTemplateId,
        }
      : null,
  });
}
