/**
 * Cleanup for stale `private.rate_limits` rows (Phase: Production Hardening).
 *
 * `hit_rate_limit` (rate-limit.ts) never deletes a row — a counter for a key
 * nobody has hit in months still sits in the table. `public.cleanup_expired_
 * rate_limits` (migration 20260911120000) does the actual DELETE; this module
 * is the only application caller and owns the one thing the SQL function
 * deliberately leaves to it: a conservative, safe retention window.
 *
 * `MIN_RETENTION_SECONDS` (1h) is comfortably above the longest current rule
 * window (`chat:org`, 3600s — see rate-limit.ts) so a row cleaned up here can
 * never still be inside an active window. Raising the retention is always
 * safe; the floor exists so a misconfigured env var can't make it unsafe.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
// Relative value import so this module (and its test) load under `node --test`.
import { reportError } from "../observability/report.ts";
import { logEvent } from "../observability/log.ts";

type Db = SupabaseClient<Database>;

const MIN_RETENTION_SECONDS = 3600; // 1 hour — safety floor.
const DEFAULT_RETENTION_SECONDS = 86_400; // 24 hours — conservative default.

/** Env `RATE_LIMIT_CLEANUP_RETENTION_SECONDS`, floored at `MIN_RETENTION_SECONDS`. */
export function resolveRateLimitRetentionSeconds(raw?: string): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  const base = Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_SECONDS;
  return Math.max(base, MIN_RETENTION_SECONDS);
}

export interface RateLimitCleanupSummary {
  deleted: number;
  retentionSeconds: number;
  durationMs: number;
}

/** Never throws — a cleanup failure is reported, not propagated. */
export async function cleanupExpiredRateLimits(
  db: Db,
  opts: { retentionSeconds?: number } = {},
): Promise<RateLimitCleanupSummary> {
  const retentionSeconds =
    opts.retentionSeconds ??
    resolveRateLimitRetentionSeconds(process.env.RATE_LIMIT_CLEANUP_RETENTION_SECONDS);
  const startedAt = Date.now();
  try {
    const { data, error } = await db.rpc("cleanup_expired_rate_limits", {
      p_older_than_seconds: retentionSeconds,
    });
    const durationMs = Date.now() - startedAt;
    if (error) {
      void reportError(error, { scope: "rate-limit.cleanup", retentionSeconds });
      return { deleted: 0, retentionSeconds, durationMs };
    }
    const deleted = typeof data === "number" ? data : 0;
    logEvent({
      event: "db.rate_limit_cleanup",
      deleted,
      retentionSeconds,
      durationMs,
    });
    return { deleted, retentionSeconds, durationMs };
  } catch (error) {
    void reportError(error, { scope: "rate-limit.cleanup", retentionSeconds });
    return { deleted: 0, retentionSeconds, durationMs: Date.now() - startedAt };
  }
}
