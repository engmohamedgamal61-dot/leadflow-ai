/**
 * Health-check primitives for `/api/health` and `/api/health/ready`.
 *
 * Deliberately minimal: no Anthropic call (never on the hot health-check
 * path — see the route docs), no lead/tenant data, no schema details. A
 * database check is one bounded, indexed, row-less query — never a table
 * scan, never something that could get slow as the app grows.
 */

// Value import via a relative path so this module (and its test) run under
// `node --test` — see `src/lib/supabase/admin.ts`'s own doc comment for why.
import { createAdminClient } from "../supabase/admin.ts";

export type DbCheckError = "not_configured" | "timeout" | "query_failed";

export interface DbCheckResult {
  ok: boolean;
  latencyMs: number;
  /** A safe, generic classification only — never the raw Postgres/network error. */
  error?: DbCheckError;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Confirm the database is actually reachable and answering — not just that
 * env vars are set. `head: true` + `.limit(1)` means PostgREST does the
 * cheapest possible real round trip: no row body, bounded to the primary key
 * index, same cost regardless of how many organizations exist.
 *
 * Never throws — every failure mode (misconfigured, slow/unreachable,
 * rejected) resolves to `{ ok: false, error: <safe classification> }`.
 */
export async function checkDatabaseConnectivity(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DbCheckResult> {
  const started = Date.now();

  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    return { ok: false, latencyMs: 0, error: "not_configured" };
  }

  try {
    const { error } = await db
      .from("organizations")
      .select("id", { head: true })
      .limit(1)
      .abortSignal(AbortSignal.timeout(timeoutMs));
    const latencyMs = Date.now() - started;
    if (error) return { ok: false, latencyMs, error: "query_failed" };
    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const timedOut =
      err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    return { ok: false, latencyMs, error: timedOut ? "timeout" : "query_failed" };
  }
}
