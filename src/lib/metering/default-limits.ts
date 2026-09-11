/**
 * Default per-org monthly AI usage cap — applied once, at organization
 * creation (see `src/lib/org/onboarding.ts`), so a new organization is never
 * silently unlimited. Reuses `organization_usage_limits` (Phase O metering) —
 * no new table, no enforcement.ts change: once the row exists, the existing
 * `checkUsageAllowed` gate and dashboard usage page treat it exactly like any
 * owner-configured limit.
 *
 * Scope, deliberately narrow:
 *   - Only new organizations get this row (called once, right after
 *     `create_organization_with_owner` succeeds). An organization created
 *     before this shipped, with no row, is untouched — this only ever INSERTs
 *     (never upserts), so it can't overwrite anything.
 *   - An org that already has ANY row (an explicit limit, or a previous call
 *     to this same function) keeps it — the insert hits the `organization_id`
 *     primary key and fails harmlessly (23505), never overwriting.
 *
 * Every number is env-configurable so ops can tune the default without a code
 * change; the constants below are the fallback when unset.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/supabase/types";
// Relative value import so this module (and its test) load under `node --test`.
import { reportError } from "../observability/report.ts";

type Db = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function positiveNumberFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolFromEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

/** Env `DEFAULT_MONTHLY_TOKEN_LIMIT` — default 5,000,000 tokens/month. */
export const DEFAULT_MONTHLY_TOKEN_LIMIT = positiveIntFromEnv(
  process.env.DEFAULT_MONTHLY_TOKEN_LIMIT,
  5_000_000,
);
/** Env `DEFAULT_MONTHLY_REQUEST_LIMIT` — default 10,000 requests/month. */
export const DEFAULT_MONTHLY_REQUEST_LIMIT = positiveIntFromEnv(
  process.env.DEFAULT_MONTHLY_REQUEST_LIMIT,
  10_000,
);
/** Env `DEFAULT_MONTHLY_COST_LIMIT_USD` — default $50/month. */
export const DEFAULT_MONTHLY_COST_LIMIT_USD = positiveNumberFromEnv(
  process.env.DEFAULT_MONTHLY_COST_LIMIT_USD,
  50,
);
/** Env `DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT` — default 80 (matches `NO_LIMITS` in limits.ts). */
export const DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT = positiveIntFromEnv(
  process.env.DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT,
  80,
);
/**
 * Env `DEFAULT_USAGE_HARD_LIMIT_ENABLED` — default true. Must be true for a
 * new org to actually be capped rather than merely shown a dashboard warning
 * ("must not be unlimited by default" means enforcement, not just a number).
 */
export const DEFAULT_USAGE_HARD_LIMIT_ENABLED = boolFromEnv(
  process.env.DEFAULT_USAGE_HARD_LIMIT_ENABLED,
  true,
);

export function buildDefaultUsageLimitsRow(
  organizationId: string,
): TablesInsert<"organization_usage_limits"> {
  return {
    organization_id: organizationId,
    monthly_token_limit: DEFAULT_MONTHLY_TOKEN_LIMIT,
    monthly_request_limit: DEFAULT_MONTHLY_REQUEST_LIMIT,
    monthly_cost_limit_usd: DEFAULT_MONTHLY_COST_LIMIT_USD,
    warning_threshold_percent: DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT,
    hard_limit_enabled: DEFAULT_USAGE_HARD_LIMIT_ENABLED,
  };
}

/**
 * Insert the default usage-limit row for a newly created organization.
 * Best-effort and non-fatal, matching the rest of the metering module's
 * fail-open philosophy — org creation must never fail because this insert
 * did. A conflict (row already exists — a retried onboarding call, or the org
 * already has an explicit limit) is expected and silently ignored; any other
 * error is reported but swallowed.
 */
export async function ensureDefaultUsageLimits(
  db: Db,
  organizationId: string,
): Promise<void> {
  const { error } = await db
    .from("organization_usage_limits")
    .insert(buildDefaultUsageLimitsRow(organizationId));
  if (!error) return;
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) return;
  void reportError(error, { scope: "metering.default-limits", organizationId });
}
