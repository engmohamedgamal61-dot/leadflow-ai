import { createAdminClient } from "@/lib/supabase/admin";
import {
  PersistenceError,
  persistChatTurn,
  type PersistChatTurnInput,
} from "@/lib/persistence/persist";

/**
 * Persist a completed chat turn.
 *
 * **Why the service-role client:** the chat widget serves anonymous prospects
 * who have no Supabase session and no organization membership, so RLS (which is
 * defined around `auth.uid()` membership) cannot authorise their writes. The
 * server is the trusted party — it has already resolved which organization the
 * widget belongs to — and writes on the prospect's behalf using the
 * service-role client, strictly inside this Node route. Authenticated members
 * still read and write their data through the anon client under RLS.
 *
 * **Never throws.** A persistence failure is logged server-side (never sent to
 * the client) and returns `null` so a successfully generated AI response is
 * never lost to a non-critical database issue.
 */
export async function persistCompletedTurn(
  input: PersistChatTurnInput,
): Promise<{ conversationId: string; leadId: string } | null> {
  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    // Supabase not configured — skip persistence (unchanged dev behaviour).
    return null;
  }

  try {
    const result = await persistChatTurn(db, input);
    return { conversationId: result.conversationId, leadId: result.leadId };
  } catch (error) {
    if (error instanceof PersistenceError) {
      console.error(
        `chat persistence failed at "${error.step}" (org ${input.organizationId}):`,
        error.cause ?? error,
      );
    } else {
      console.error("chat persistence failed (unexpected):", error);
    }
    return null;
  }
}
