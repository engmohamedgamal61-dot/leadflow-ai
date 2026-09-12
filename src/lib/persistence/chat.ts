// Value imports use relative paths so this module (and its tests) run under
// `node --test`. Type-only imports are erased and may use the `@/` alias.
import { createAdminClient } from "../supabase/admin.ts";
import { reportError } from "../observability/report.ts";
import {
  PersistenceError,
  classifyPersistenceFailure,
  persistChatTurn,
  type PersistChatTurnInput,
  type PersistenceFailureReason,
} from "./persist.ts";

/**
 * Result of attempting to persist one completed chat turn — callers must be
 * able to tell these apart (see docs/... / the Supabase-outage hardening
 * work): a successfully generated AI reply must never be reported to the
 * end user or to ops as if the turn fully succeeded when it didn't.
 *
 *  - "ok"            — persisted (or matched/merged into an existing row —
 *                       see persistChatTurn's own idempotency guarantees;
 *                       a replayed/duplicate turn is just another "ok").
 *  - "not_configured" — Supabase isn't configured at all (local dev without
 *                       env vars). Expected, not a failure — never alerted.
 *  - "failed"         — a genuine persistence attempt threw. `reason`
 *                       ("transient" | "permanent") is for alert triage only;
 *                       retrying is safe either way.
 */
export type PersistTurnOutcome =
  | { status: "ok"; conversationId: string; leadId: string }
  | { status: "not_configured" }
  | { status: "failed"; reason: PersistenceFailureReason };

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
 * **Never throws.** A persistence failure is logged (structured, redacted)
 * and reported through the ops alert path (deduped — see `reportError`'s
 * `alertDedupKey`) — never sent to the client directly, and never allowed to
 * take down an already-generated AI response. The caller decides what a
 * `"failed"` outcome means for the response it sends back.
 */
export async function persistCompletedTurn(
  input: PersistChatTurnInput,
): Promise<PersistTurnOutcome> {
  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    // Supabase not configured — skip persistence (unchanged dev behaviour).
    return { status: "not_configured" };
  }

  try {
    const result = await persistChatTurn(db, input);
    return { status: "ok", conversationId: result.conversationId, leadId: result.leadId };
  } catch (error) {
    const reason = classifyPersistenceFailure(error);
    void reportError(error, {
      scope: "chat.persistence",
      requestId: input.requestId ?? null,
      organizationId: input.organizationId,
      operation: error instanceof PersistenceError ? error.step : "unknown",
      reason,
      severity: "high",
      // One alert per minute for the whole (warm) process, not one per
      // request — a sustained outage would otherwise fire one alert per
      // chat turn. See `ErrorContext.alertDedupKey`.
      alertDedupKey: "chat.persistence.failed",
      alertDedupWindowMs: 60_000,
    });
    return { status: "failed", reason };
  }
}
