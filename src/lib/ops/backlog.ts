/**
 * Operational backlog/staleness summary — follow-up scheduler, Integration
 * Hub worker, and rate-limit cleanup. Backs `/api/internal/ops/summary`.
 *
 * Every number here comes from a `service_role`-only SQL function
 * (migration `20260913090000_ops_monitoring.sql`) that returns SAFE
 * AGGREGATE COUNTS ONLY — no lead name, note, payload, URL, or org name.
 * Never throws: a missing/erroring dependency shows up as a field in
 * `errors`, never an exception — this summary itself must never become
 * another thing that can go down.
 */

// Value import via a relative path so this module (and its test) run under
// `node --test` — see `src/lib/supabase/admin.ts`'s own doc comment for why.
import { createAdminClient } from "../supabase/admin.ts";
import { resolveStuckAfterMs as resolveFollowUpStuckAfterMs } from "../follow-ups/config.ts";
import { resolveStuckAfterMs as resolveIntegrationStuckAfterMs } from "../integrations/config.ts";

export interface FollowUpBacklog {
  pendingDue: number;
  stuckProcessing: number;
  failed: number;
  oldestDueSeconds: number | null;
}

export interface IntegrationHubBacklog {
  pendingFanout: number;
  pendingDeliveries: number;
  stuckDelivering: number;
  dead: number;
  oldestPendingSeconds: number | null;
}

export interface RateLimitBacklog {
  staleCount: number;
}

export interface OpsBacklogSummary {
  status: "ok" | "not_configured" | "error";
  followUps?: FollowUpBacklog;
  integrationHub?: IntegrationHubBacklog;
  rateLimitCleanup?: RateLimitBacklog;
  /** Safe classification strings only — never a raw Postgres/network error. */
  errors?: string[];
}

/** `123456` ms -> `'123 seconds'`, the interval literal shape Postgres accepts as text. */
function msToIntervalLiteral(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))} seconds`;
}

export async function getOpsBacklogSummary(): Promise<OpsBacklogSummary> {
  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    return { status: "not_configured" };
  }

  const errors: string[] = [];

  const [followUpsResult, hubResult, rateLimitResult] = await Promise.all([
    db
      .rpc("follow_up_backlog_summary", {
        p_stuck_after: msToIntervalLiteral(
          resolveFollowUpStuckAfterMs(process.env.FOLLOW_UP_STUCK_PROCESSING_MS),
        ),
      })
      .maybeSingle(),
    db
      .rpc("integration_hub_backlog_summary", {
        p_stuck_after: msToIntervalLiteral(
          resolveIntegrationStuckAfterMs(process.env.INTEGRATION_HUB_STUCK_DELIVERING_MS),
        ),
      })
      .maybeSingle(),
    // Matches the SQL function's own default (48h — 2x the cleanup cron's
    // 24h default retention); passed explicitly since the generated Args
    // type doesn't know about SQL-side defaults.
    db.rpc("rate_limit_backlog_summary", { p_stale_after_seconds: 172_800 }).maybeSingle(),
  ]);

  let followUps: FollowUpBacklog | undefined;
  if (followUpsResult.error || !followUpsResult.data) {
    errors.push("follow_ups_query_failed");
  } else {
    const row = followUpsResult.data;
    followUps = {
      pendingDue: Number(row.pending_due) || 0,
      stuckProcessing: Number(row.stuck_processing) || 0,
      failed: Number(row.failed) || 0,
      oldestDueSeconds: row.oldest_due_seconds === null ? null : Number(row.oldest_due_seconds),
    };
  }

  let integrationHub: IntegrationHubBacklog | undefined;
  if (hubResult.error || !hubResult.data) {
    errors.push("integration_hub_query_failed");
  } else {
    const row = hubResult.data;
    integrationHub = {
      pendingFanout: Number(row.pending_fanout) || 0,
      pendingDeliveries: Number(row.pending_deliveries) || 0,
      stuckDelivering: Number(row.stuck_delivering) || 0,
      dead: Number(row.dead) || 0,
      oldestPendingSeconds:
        row.oldest_pending_seconds === null ? null : Number(row.oldest_pending_seconds),
    };
  }

  let rateLimitCleanup: RateLimitBacklog | undefined;
  if (rateLimitResult.error || !rateLimitResult.data) {
    errors.push("rate_limit_query_failed");
  } else {
    rateLimitCleanup = { staleCount: Number(rateLimitResult.data.stale_count) || 0 };
  }

  return {
    status: errors.length === 0 ? "ok" : "error",
    ...(followUps ? { followUps } : {}),
    ...(integrationHub ? { integrationHub } : {}),
    ...(rateLimitCleanup ? { rateLimitCleanup } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  };
}
