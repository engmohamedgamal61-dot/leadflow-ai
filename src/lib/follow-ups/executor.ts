/**
 * Executes ONE claimed follow-up: render a message, hand it to the channel
 * adapter, and record the outcome. Decoupled from the channel implementation
 * and from HTTP.
 *
 * Every write is scoped by `organization_id` (defence in depth even on the
 * trusted client) and guarded by `.eq("status", "processing")` so a race with
 * a user cancellation resolves atomically in the database: whoever transitions
 * the row first wins, and a `cancelled` row is never finalised as executed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/supabase/types";
import {
  resolveAdapter,
  type FollowUpChannelAdapter,
  type FollowUpDeliveryResult,
} from "./channels.ts";
import { buildFollowUpMessage } from "./message.ts";
import { nextAttemptAt } from "./config.ts";

type Db = SupabaseClient<Database>;

export interface ClaimedFollowUp {
  id: string;
  organizationId: string;
  leadId: string;
  conversationId: string | null;
  note: string | null;
  source: string;
  channel: string;
  /** attempt_count AFTER the claim incremented it (1 = first attempt). */
  attemptCount: number;
  orgHasMembers: boolean;
  leadName: string | null;
}

export type FollowUpDisposition =
  | "completed"
  | "retry_scheduled"
  | "failed"
  | "skipped";

export interface ExecuteFollowUpOptions {
  maxAttempts: number;
  now?: Date;
  adapters?: Record<string, FollowUpChannelAdapter>;
}

function eventMeta(v: Record<string, unknown>): TablesInsert<"lead_events">["metadata"] {
  return v as TablesInsert<"lead_events">["metadata"];
}

async function recordEvent(
  db: Db,
  claimed: ClaimedFollowUp,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("lead_events").insert({
    organization_id: claimed.organizationId,
    lead_id: claimed.leadId,
    event_type: eventType,
    metadata: eventMeta(metadata),
  });
  if (error) {
    console.error(`follow-up event "${eventType}" insert failed:`, error.message);
  }
}

export async function executeFollowUp(
  db: Db,
  claimed: ClaimedFollowUp,
  opts: ExecuteFollowUpOptions,
): Promise<FollowUpDisposition> {
  const now = opts.now ?? new Date();
  const isDemo = !claimed.orgHasMembers;

  // Demo orgs never reach a real external channel — belt & braces on top of
  // "no external adapters exist in Phase G".
  const channel = isDemo ? "internal" : claimed.channel;
  const adapter = resolveAdapter(channel, opts.adapters);

  const message = buildFollowUpMessage({
    note: claimed.note,
    leadName: claimed.leadName,
  });

  let result: FollowUpDeliveryResult;
  try {
    result = await adapter.deliver({
      organizationId: claimed.organizationId,
      leadId: claimed.leadId,
      conversationId: claimed.conversationId,
      channel,
      message,
      isDemo,
    });
  } catch (error) {
    result = {
      ok: false,
      retryable: true,
      detail:
        error instanceof Error ? error.message.slice(0, 300) : "adapter threw",
    };
  }

  // ── success ────────────────────────────────────────────────────────────
  if (result.ok) {
    const { data, error } = await db
      .from("lead_follow_ups")
      .update({
        status: "completed",
        completed_at: now.toISOString(),
        last_error: null,
        claimed_at: null,
      })
      .eq("organization_id", claimed.organizationId)
      .eq("id", claimed.id)
      .eq("status", "processing")
      .select("id");
    if (error || !data || data.length === 0) {
      // Cancelled mid-flight, or another worker already finalised it.
      return "skipped";
    }
    await recordEvent(db, claimed, "follow_up_executed", {
      followUpId: claimed.id,
      channel,
      source: claimed.source,
      attempt: claimed.attemptCount,
    });
    return "completed";
  }

  // ── retryable failure with attempts left ───────────────────────────────
  if (result.retryable && claimed.attemptCount < opts.maxAttempts) {
    const nextAt = nextAttemptAt(claimed.attemptCount, now);
    const { data } = await db
      .from("lead_follow_ups")
      .update({
        status: "pending",
        next_attempt_at: nextAt,
        last_error: (result.detail ?? "delivery failed").slice(0, 500),
        claimed_at: null,
      })
      .eq("organization_id", claimed.organizationId)
      .eq("id", claimed.id)
      .eq("status", "processing")
      .select("id");
    if (!data || data.length === 0) return "skipped";
    await recordEvent(db, claimed, "follow_up_retry_scheduled", {
      followUpId: claimed.id,
      attempt: claimed.attemptCount,
      nextAttemptAt: nextAt,
    });
    return "retry_scheduled";
  }

  // ── terminal failure (non-retryable, or attempts exhausted) ────────────
  const { data } = await db
    .from("lead_follow_ups")
    .update({
      status: "failed",
      last_error: (result.detail ?? "delivery failed").slice(0, 500),
      claimed_at: null,
    })
    .eq("organization_id", claimed.organizationId)
    .eq("id", claimed.id)
    .eq("status", "processing")
    .select("id");
  if (!data || data.length === 0) return "skipped";
  await recordEvent(db, claimed, "follow_up_failed", {
    followUpId: claimed.id,
    channel,
    attempt: claimed.attemptCount,
    error: (result.detail ?? "delivery failed").slice(0, 200),
  });
  return "failed";
}
