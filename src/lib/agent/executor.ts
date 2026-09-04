/**
 * The ONLY place agent actions touch the database.
 *
 * Callers supply an already-authorized Supabase client (`db`): the chat route
 * uses the trusted service-role client (same boundary as `persistChatTurn` —
 * anonymous prospects have no session), the dashboard uses the RLS-scoped
 * session client after a role check. Every write is organization- and
 * lead-scoped and best-effort: an executor never throws, it records an outcome.
 *
 * Idempotency: events are upserted on `(lead_id, request_id, event_type)` and
 * follow-ups on `(lead_id, creation_request_id)` — a retried turn (same
 * `requestId`) collapses to one. `mark_qualified` is additionally a no-op once
 * the lead is already qualified.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/supabase/types";
import { normalizeNote, type ProposedAction, type AgentActionType } from "./actions.ts";

type Db = SupabaseClient<Database>;

/** Statuses at or past "qualified" — `mark_qualified` is a no-op for these. */
const QUALIFIED_OR_LATER = new Set(["qualified", "appointment", "won"]);

export interface AgentExecContext {
  db: Db;
  organizationId: string;
  leadId: string;
  conversationId: string | null;
  /** Idempotency key for this turn/submission, or null. */
  requestId: string | null;
  source: "chat" | "manual";
}

export interface AgentActionOutcome {
  type: AgentActionType;
  status: "executed" | "skipped" | "failed";
  detail?: string;
  /** Set for a created follow-up. */
  followUpId?: string;
}

function metaJson(v: Record<string, unknown>): TablesInsert<"lead_events">["metadata"] {
  return v as TablesInsert<"lead_events">["metadata"];
}

/** Insert an audit event, idempotent on (lead_id, request_id, event_type). */
async function recordEvent(
  ctx: AgentExecContext,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<"inserted" | "duplicate" | "failed"> {
  const { data, error } = await ctx.db
    .from("lead_events")
    .upsert(
      {
        organization_id: ctx.organizationId,
        lead_id: ctx.leadId,
        event_type: eventType,
        metadata: metaJson(metadata),
        request_id: ctx.requestId,
      },
      { onConflict: "lead_id,request_id,event_type", ignoreDuplicates: true },
    )
    .select("id");
  if (error) {
    console.error(`lead_event "${eventType}" insert failed:`, error);
    return "failed";
  }
  return data && data.length > 0 ? "inserted" : "duplicate";
}

export async function markQualified(
  ctx: AgentExecContext,
): Promise<AgentActionOutcome> {
  const { data: lead, error } = await ctx.db
    .from("leads")
    .select("status")
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.leadId)
    .maybeSingle();
  if (error) return { type: "mark_qualified", status: "failed", detail: "read failed" };
  if (!lead) return { type: "mark_qualified", status: "failed", detail: "lead not found" };

  if (QUALIFIED_OR_LATER.has(lead.status)) {
    return { type: "mark_qualified", status: "skipped", detail: "already qualified" };
  }

  const { data: updated, error: updateError } = await ctx.db
    .from("leads")
    .update({ status: "qualified" })
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.leadId)
    .select("id");
  if (updateError || !updated || updated.length === 0) {
    return { type: "mark_qualified", status: "failed", detail: "not permitted" };
  }

  await recordEvent(ctx, "status_changed", { from: lead.status, to: "qualified" });
  await recordEvent(ctx, "lead_qualified", { source: ctx.source });
  return { type: "mark_qualified", status: "executed" };
}

export async function createFollowUp(
  ctx: AgentExecContext,
  input: { scheduledAt: string; note?: string | null },
): Promise<AgentActionOutcome> {
  const row: TablesInsert<"lead_follow_ups"> = {
    organization_id: ctx.organizationId,
    lead_id: ctx.leadId,
    conversation_id: ctx.conversationId,
    scheduled_at: input.scheduledAt,
    status: "pending",
    note: normalizeNote(input.note ?? null),
    source: ctx.source,
    creation_request_id: ctx.requestId,
  };

  const { data, error } = await ctx.db
    .from("lead_follow_ups")
    .upsert(row, {
      onConflict: "lead_id,creation_request_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) {
    return { type: "create_follow_up", status: "failed", detail: "not permitted" };
  }

  let followUpId: string | undefined = data?.[0]?.id;
  let skipped = false;
  if (!followUpId && ctx.requestId) {
    // Lost an idempotency race — a retry already created it.
    const existing = await ctx.db
      .from("lead_follow_ups")
      .select("id")
      .eq("lead_id", ctx.leadId)
      .eq("creation_request_id", ctx.requestId)
      .maybeSingle();
    followUpId = existing.data?.id;
    skipped = true;
  }
  if (!followUpId) {
    return { type: "create_follow_up", status: "failed", detail: "no row" };
  }

  await recordEvent(ctx, "follow_up_created", {
    followUpId,
    scheduledAt: input.scheduledAt,
    source: ctx.source,
  });
  return {
    type: "create_follow_up",
    status: skipped ? "skipped" : "executed",
    followUpId,
  };
}

export async function requestHumanHandoff(
  ctx: AgentExecContext,
  input: { reason?: string | null },
): Promise<AgentActionOutcome> {
  const result = await recordEvent(ctx, "human_handoff_requested", {
    reason: normalizeNote(input.reason ?? null),
    source: ctx.source,
  });
  if (result === "failed") {
    return { type: "request_human_handoff", status: "failed" };
  }
  return {
    type: "request_human_handoff",
    status: result === "duplicate" ? "skipped" : "executed",
  };
}

/**
 * Run the deterministic `mark_qualified` (when the caller says qualification is
 * complete) plus the AI-proposed, already-validated actions.
 */
export async function executeAgentActions(
  ctx: AgentExecContext,
  input: {
    markQualified: boolean;
    proposedActions: ProposedAction[];
  },
): Promise<AgentActionOutcome[]> {
  const outcomes: AgentActionOutcome[] = [];

  try {
    if (input.markQualified) {
      outcomes.push(await markQualified(ctx));
    }
    for (const action of input.proposedActions) {
      if (action.type === "create_follow_up") {
        outcomes.push(
          await createFollowUp(ctx, {
            scheduledAt: action.scheduledAt,
            note: action.reason,
          }),
        );
      } else if (action.type === "request_human_handoff") {
        outcomes.push(await requestHumanHandoff(ctx, { reason: action.reason }));
      }
    }
  } catch (error) {
    console.error("agent action execution error:", error);
  }

  return outcomes;
}
