// Relative value import so this route (and its test) run under `node --test`.
import { checkDatabaseConnectivity } from "../../../../lib/health/check.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness — "can this instance actually serve real traffic right now?"
 *
 * Checks the one dependency that would make the app genuinely unable to
 * serve a request if it were down: the database. Deliberately does **not**
 * call Anthropic — a chat reply degrading (rate-limited, slow, briefly down)
 * is not "this instance is broken," and a health check must not spend a paid
 * API call on every poll. See `src/lib/health/check.ts` for why the database
 * check itself is a single, cheap, bounded, row-less query.
 *
 * Status codes:
 *   200 — database reachable, this instance is ready for traffic.
 *   503 — database unreachable/erroring; a load balancer should stop
 *         routing here (and, unlike `/api/health`, a platform MAY use this
 *         to gate a rolling deploy or hold traffic — never to restart the
 *         process, since restarting doesn't fix a database outage).
 *
 * Public — no session, no secret — same reasoning as `/api/health`. The body
 * never carries anything beyond a coarse status, a safe error classification
 * (never a raw Postgres/network error string), and a latency number.
 */
export async function GET() {
  const db = await checkDatabaseConnectivity();

  const body = {
    status: db.ok ? "ok" : "degraded",
    time: new Date().toISOString(),
    checks: {
      database: {
        status: db.ok ? "ok" : "down",
        latencyMs: db.latencyMs,
        ...(db.error ? { error: db.error } : {}),
      },
    },
  };

  return Response.json(body, {
    status: db.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
