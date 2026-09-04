/**
 * The follow-up scheduler engine — decoupled from HTTP. A thin route
 * (`/api/internal/follow-ups/run`) is the only trigger; a platform cron just
 * calls that route.
 *
 * One run: claim a bounded batch of due follow-ups atomically (via
 * `private.claim_due_follow_ups`, which uses `FOR UPDATE SKIP LOCKED` so
 * concurrent workers never take the same row), execute each, and return a
 * counts-only summary. No lead PII is logged or returned.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
// Relative value import so the scheduler (and its integration test) load under
// `node --test`. `@/`-aliased type-only imports are still fine (erased).
import { createAdminClient } from "../supabase/admin.ts";
import {
  resolveBatchSize,
  resolveMaxAttempts,
  resolveStuckAfterMs,
} from "./config.ts";
import {
  executeFollowUp,
  type ClaimedFollowUp,
  type FollowUpDisposition,
} from "./executor.ts";
import type { FollowUpChannelAdapter } from "./channels.ts";

type Db = SupabaseClient<Database>;

export interface SchedulerRunSummary {
  runId: string;
  claimed: number;
  completed: number;
  retryScheduled: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

interface ClaimRow {
  id: string;
  organization_id: string;
  lead_id: string;
  conversation_id: string | null;
  note: string | null;
  source: string;
  channel: string;
  attempt_count: number;
  org_has_members: boolean;
  lead_name: string | null;
}

export interface RunSchedulerOptions {
  batchSize?: number;
  maxAttempts?: number;
  stuckAfterMs?: number;
  now?: Date;
  /** Test seam — override the channel registry. */
  adapters?: Record<string, FollowUpChannelAdapter>;
  /**
   * Test seam — inject the (already-trusted) Supabase client. Production omits
   * this and the service-role admin client is created here.
   */
  db?: Db;
}

const EMPTY = (runId: string, durationMs: number): SchedulerRunSummary => ({
  runId,
  claimed: 0,
  completed: 0,
  retryScheduled: 0,
  failed: 0,
  skipped: 0,
  durationMs,
});

export async function runFollowUpScheduler(
  opts: RunSchedulerOptions = {},
): Promise<SchedulerRunSummary> {
  const runId =
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`
    ).slice(0, 8);
  const started = Date.now();

  const batchSize =
    opts.batchSize ?? resolveBatchSize(process.env.FOLLOW_UP_BATCH_SIZE);
  const maxAttempts =
    opts.maxAttempts ?? resolveMaxAttempts(process.env.FOLLOW_UP_MAX_ATTEMPTS);
  const stuckAfterMs =
    opts.stuckAfterMs ??
    resolveStuckAfterMs(process.env.FOLLOW_UP_STUCK_PROCESSING_MS);

  let db: Db;
  try {
    db = opts.db ?? (createAdminClient() as Db);
  } catch {
    return EMPTY(runId, Date.now() - started);
  }

  const { data, error } = await db.rpc("claim_due_follow_ups", {
    p_limit: batchSize,
    p_stuck_after: `${Math.round(stuckAfterMs / 1000)} seconds`,
  });

  if (error) {
    console.error(`[follow-up-scheduler] run=${runId} claim failed:`, error.message);
    return EMPTY(runId, Date.now() - started);
  }

  const rows = (data ?? []) as ClaimRow[];
  const summary = EMPTY(runId, 0);
  summary.claimed = rows.length;

  for (const row of rows) {
    const claimed: ClaimedFollowUp = {
      id: row.id,
      organizationId: row.organization_id,
      leadId: row.lead_id,
      conversationId: row.conversation_id,
      note: row.note,
      source: row.source,
      channel: row.channel,
      attemptCount: row.attempt_count,
      orgHasMembers: row.org_has_members,
      leadName: row.lead_name,
    };

    let disposition: FollowUpDisposition;
    try {
      disposition = await executeFollowUp(db, claimed, {
        maxAttempts,
        now: opts.now,
        adapters: opts.adapters,
      });
    } catch (err) {
      console.error(
        `[follow-up-scheduler] run=${runId} follow-up ${row.id} threw:`,
        err instanceof Error ? err.message : err,
      );
      disposition = "skipped";
    }

    if (disposition === "completed") summary.completed += 1;
    else if (disposition === "retry_scheduled") summary.retryScheduled += 1;
    else if (disposition === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }

  summary.durationMs = Date.now() - started;
  console.log(
    `[follow-up-scheduler] run=${runId} claimed=${summary.claimed} completed=${summary.completed} retry=${summary.retryScheduled} failed=${summary.failed} skipped=${summary.skipped} duration=${summary.durationMs}ms`,
  );
  return summary;
}
