/**
 * The metering service — the single entry point every Anthropic caller uses to
 * record what a call cost. Provider-agnostic in shape; today it only knows
 * Anthropic token usage.
 *
 * **Never throws and never blocks the reply.** Metering is observability, not a
 * critical path: a failure here is logged and swallowed so a generated AI
 * response is never lost to a metering issue (same contract as
 * `persistCompletedTurn`). It also adds NO extra Anthropic call — every record
 * is built from the `usage` object the SDK already returned.
 *
 * Writes use the service-role client: the public chat widget has no session,
 * and the trusted server has already resolved which organization the call
 * belongs to (exactly like `persistCompletedTurn`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
// Relative value import so this module and its tests run under `node --test`
// (the `@/` alias is not resolved for value imports there) — same as persist.ts.
import { createAdminClient } from "../supabase/admin.ts";
import type { Database, TablesInsert } from "@/lib/supabase/types";
import { estimateCostUsd } from "./pricing.ts";
import { normalizeAnthropicUsage, totalTokens, type RecordUsageInput } from "./types.ts";

type Db = SupabaseClient<Database>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the `ai_usage_events` row for a call (pure — estimates the cost from
 * the centralized pricing config). Exported for tests and for callers that want
 * to inspect the estimate before recording.
 */
export function buildUsageRow(
  input: RecordUsageInput,
): TablesInsert<"ai_usage_events"> {
  const usage = input.usage;
  const estimatedCost = estimateCostUsd({ model: input.model, ...usage });
  const requestId =
    typeof input.requestId === "string" && UUID_RE.test(input.requestId)
      ? input.requestId
      : null;

  return {
    organization_id: input.organizationId,
    request_type: input.requestType,
    model: input.model,
    channel: input.channel ?? null,
    input_tokens: usage.inputTokens || 0,
    output_tokens: usage.outputTokens || 0,
    cache_read_input_tokens: usage.cacheReadInputTokens || 0,
    cache_creation_input_tokens: usage.cacheCreationInputTokens || 0,
    estimated_cost_usd: estimatedCost,
    conversation_id: input.conversationId ?? null,
    lead_id: input.leadId ?? null,
    request_id: requestId,
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
  };
}

export interface RecordUsageResult {
  ok: boolean;
  /** Estimated USD cost of the recorded call (0 when nothing was recorded). */
  estimatedCostUsd: number;
  /** Total billable tokens for the recorded call. */
  totalTokens: number;
}

/**
 * Record one Anthropic call's usage for an organization. Idempotent on
 * `(organization_id, request_id, request_type)` — a retried chat turn that
 * re-runs reply + extraction with the same request id records at most one row
 * per type.
 */
export async function recordAiUsage(
  input: RecordUsageInput,
  deps: { db?: Db } = {},
): Promise<RecordUsageResult> {
  const usage = input.usage;
  const cost = estimateCostUsd({ model: input.model, ...usage });
  const tokens = totalTokens(usage);
  const noop: RecordUsageResult = { ok: false, estimatedCostUsd: cost, totalTokens: tokens };

  if (!input.organizationId) return noop;
  // Nothing to record (all zero) — skip the write but report the (zero) estimate.
  if (tokens === 0) return { ok: true, estimatedCostUsd: 0, totalTokens: 0 };

  let db: Db;
  try {
    db = deps.db ?? createAdminClient();
  } catch {
    // Supabase not configured — metering is skipped, same as persistence.
    return noop;
  }

  const row = buildUsageRow(input);
  try {
    const { error } = await db.from("ai_usage_events").upsert(row, {
      onConflict: "organization_id,request_id,request_type",
      ignoreDuplicates: true,
    });
    if (error) {
      console.error(
        `[metering] failed to record ${input.requestType} usage (org ${input.organizationId}):`,
        error.message,
      );
      return noop;
    }
  } catch (error) {
    console.error("[metering] unexpected error recording usage:", error);
    return noop;
  }

  return { ok: true, estimatedCostUsd: cost, totalTokens: tokens };
}

/** Convenience: record from a raw Anthropic `usage` object. */
export async function recordAnthropicUsage(
  input: Omit<RecordUsageInput, "usage"> & {
    usage:
      | Parameters<typeof normalizeAnthropicUsage>[0]
      | RecordUsageInput["usage"];
  },
  deps?: { db?: Db },
): Promise<RecordUsageResult> {
  const raw = input.usage as Record<string, unknown> | null | undefined;
  const normalized =
    raw && ("inputTokens" in raw || "outputTokens" in raw)
      ? (input.usage as RecordUsageInput["usage"])
      : normalizeAnthropicUsage(raw as Parameters<typeof normalizeAnthropicUsage>[0]);
  return recordAiUsage({ ...input, usage: normalized }, deps);
}
