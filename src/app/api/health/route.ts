export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness — "is this process up and able to answer HTTP at all?"
 *
 * Deliberately checks nothing: no database, no Anthropic, no other
 * dependency. If this process can run this handler, it's alive by
 * definition — that's the entire point of separating liveness from
 * readiness (`/api/health/ready`, which does check the database). A
 * platform's restart-the-instance health check should point here, never at
 * `/ready` — restarting a process because a downstream dependency is
 * degraded doesn't fix the dependency and just adds churn.
 *
 * Always `200` when reachable. Public — no session, no secret, no
 * `Authorization` header required, matching every external monitor's
 * expectation (uptime checkers, load balancers). Never returns anything
 * beyond a fixed, static-shaped body: no ids, no counts, no schema.
 */
export function GET() {
  return Response.json(
    { status: "ok", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
