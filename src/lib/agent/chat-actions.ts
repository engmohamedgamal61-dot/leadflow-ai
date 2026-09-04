import { createAdminClient } from "@/lib/supabase/admin";
import {
  executeAgentActions,
  type AgentActionOutcome,
} from "@/lib/agent/executor";
import type { ProposedAction } from "@/lib/agent/actions";

/**
 * Run agent actions for a just-persisted chat turn.
 *
 * Uses the same trusted server boundary as `persistCompletedTurn` — the
 * service-role client, strictly inside the Node route — because anonymous
 * prospects have no session for RLS to authorise. The organization and lead
 * were already resolved and persisted by the caller. Never throws.
 */
export async function runChatAgentActions(input: {
  organizationId: string;
  leadId: string;
  conversationId: string | null;
  /** The turn's idempotency key — a retried turn re-runs harmlessly. */
  requestId: string | null;
  /** Deterministic result of `isQualificationComplete` (app code, not Claude). */
  markQualified: boolean;
  proposedActions: ProposedAction[];
}): Promise<AgentActionOutcome[]> {
  if (!input.markQualified && input.proposedActions.length === 0) return [];

  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    return [];
  }

  try {
    return await executeAgentActions(
      {
        db,
        organizationId: input.organizationId,
        leadId: input.leadId,
        conversationId: input.conversationId,
        requestId: input.requestId,
        source: "chat",
      },
      {
        markQualified: input.markQualified,
        proposedActions: input.proposedActions,
      },
    );
  } catch (error) {
    console.error("chat agent actions failed:", error);
    return [];
  }
}
