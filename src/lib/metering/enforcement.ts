/**
 * Pre-call usage-limit enforcement — the deterministic gate run BEFORE a new
 * Anthropic call for an organization.
 *
 * Contract:
 *   - No `organization_usage_limits` row  → `{ allowed: true }` immediately, no
 *     aggregate query (the common case; existing chat behaviour is unchanged).
 *   - Row exists, hard limit OFF           → `{ allowed: true }` (advisory only).
 *   - Row exists, hard limit ON, a limited dimension exceeded for the current
 *     billing month → `{ allowed: false }`.
 *   - Any error (DB down, RPC missing)     → `{ allowed: true }` — FAIL OPEN, so
 *     a metering problem never takes chat offline (mirrors `enforceRateLimit`).
 *
 * Reads use the service-role client: the caller (chat route / WhatsApp webhook)
 * has already resolved the organization, and the public widget has no session.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
// Relative value import so this module and its tests run under `node --test`.
import { createAdminClient } from "../supabase/admin.ts";
import type { Database } from "@/lib/supabase/types";
import { currentMonthRange } from "./period.ts";
import {
  evaluateUsageLimits,
  NO_LIMITS,
  type LimitEvaluation,
  type LimitState,
  type UsageLimits,
  type UsageTotals,
} from "./limits.ts";

type Db = SupabaseClient<Database>;

export interface UsageGateResult {
  allowed: boolean;
  state: LimitState;
  /** `null` when no limits are configured or the check could not run. */
  evaluation: LimitEvaluation | null;
}

const ALLOW: UsageGateResult = { allowed: true, state: "ok", evaluation: null };

export async function loadUsageLimits(
  db: Db,
  organizationId: string,
): Promise<UsageLimits | null> {
  const { data, error } = await db
    .from("organization_usage_limits")
    .select(
      "monthly_token_limit, monthly_request_limit, monthly_cost_limit_usd, warning_threshold_percent, hard_limit_enabled",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    monthlyTokenLimit: data.monthly_token_limit,
    monthlyRequestLimit: data.monthly_request_limit,
    monthlyCostLimitUsd: data.monthly_cost_limit_usd,
    warningThresholdPercent: data.warning_threshold_percent,
    hardLimitEnabled: data.hard_limit_enabled,
  };
}

async function loadCurrentMonthTotals(
  db: Db,
  organizationId: string,
  now: Date,
): Promise<UsageTotals | null> {
  const { startIso, endIso } = currentMonthRange(now);
  const { data, error } = await db.rpc("org_ai_usage_totals", {
    p_org_id: organizationId,
    p_from: startIso,
    p_to: endIso,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { totalTokens: 0, totalRequests: 0, totalCostUsd: 0 };
  return {
    totalTokens: Number(row.total_tokens ?? 0),
    totalRequests: Number(row.total_requests ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? 0),
  };
}

/**
 * Should a new Anthropic call for this org be allowed right now?
 *
 * `deps.db` is injectable for tests; production passes nothing and a service-
 * role client is created. `deps.limits` / `deps.totals` let tests drive the
 * decision without a database at all.
 */
export async function checkUsageAllowed(
  organizationId: string,
  deps: {
    db?: Db;
    now?: Date;
    limits?: UsageLimits | null;
    totals?: UsageTotals | null;
  } = {},
): Promise<UsageGateResult> {
  if (!organizationId) return ALLOW;
  const now = deps.now ?? new Date();

  let db: Db | null = null;
  if (deps.limits === undefined || deps.totals === undefined) {
    try {
      db = deps.db ?? createAdminClient();
    } catch {
      return ALLOW; // Supabase not configured — fail open.
    }
  }

  try {
    const limits =
      deps.limits !== undefined
        ? deps.limits
        : await loadUsageLimits(db as Db, organizationId);

    // No limits configured → unchanged behaviour, no aggregate query.
    if (!limits) return ALLOW;

    // Advisory-only mode: never blocks, and the warn/ok state is for the
    // dashboard, not the hot path — skip the aggregate query here.
    if (!limits.hardLimitEnabled) {
      return { allowed: true, state: "ok", evaluation: null };
    }

    const totals =
      deps.totals !== undefined
        ? deps.totals
        : await loadCurrentMonthTotals(db as Db, organizationId, now);

    // Couldn't read usage — fail open.
    if (!totals) return ALLOW;

    const evaluation = evaluateUsageLimits(totals, limits ?? NO_LIMITS);
    return {
      allowed: evaluation.allowNewRequests,
      state: evaluation.state,
      evaluation,
    };
  } catch (error) {
    console.error("[metering] usage gate check failed (allowing):", error);
    return ALLOW;
  }
}
