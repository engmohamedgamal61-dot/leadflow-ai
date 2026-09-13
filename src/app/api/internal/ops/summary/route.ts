import type { NextRequest } from "next/server";
// Relative value imports so this route (and its test) run under `node --test`
// — same convention as the other `/api/internal/*` routes.
import { checkCronSecret } from "../../../../../lib/follow-ups/auth.ts";
import { getOpsBacklogSummary } from "../../../../../lib/ops/backlog.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Queue/backlog visibility for the follow-up scheduler, the Integration Hub
 * worker, and rate-limit cleanup — "is a cron falling behind, stuck, or
 * failing repeatedly?" in one place. Not public: requires the server-only
 * `OPS_STATUS_SECRET` via `Authorization: Bearer <secret>` or
 * `x-cron-secret` — the exact same shape as the cron trigger routes,
 * reusing `checkCronSecret` unchanged.
 *
 * Every number returned is a pre-aggregated count/age from a
 * `service_role`-only SQL function — never a raw row, lead name, note,
 * payload, or webhook URL. Safe to point an external monitor at, as long as
 * the monitor holds the secret (this endpoint is not meant to be public the
 * way `/api/health` is — it exposes operational volume, which `/api/health`
 * deliberately does not).
 */
async function handle(request: NextRequest): Promise<Response> {
  // Auth contract (verified — see route.test.ts / route.integration.test.ts):
  //   A. OPS_STATUS_SECRET unset      -> 503, before any credential is even
  //      checked. This is a "feature not turned on" response, not an
  //      auth decision — identical to every other `/api/internal/*` cron
  //      route (`FOLLOW_UP_CRON_SECRET` etc.) for the same reason: an
  //      operator who never set the secret gets a clear "not configured"
  //      signal instead of a misleading 401 that implies the feature exists
  //      and just rejected them.
  //   B. secret set, no Authorization/x-cron-secret -> 401 (below).
  //   C. secret set, wrong bearer                   -> 401 (below).
  //   D. secret set, correct bearer                 -> 200 with the summary
  //      (or 503 only if Supabase itself isn't configured — a database
  //      config problem, not an auth outcome).
  // 503 is never returned as a stand-in for "wrong credentials" — a caller
  // with the correct secret always gets 401 answered as 401, never masked
  // as unavailable, and a caller with no/wrong credentials never gets past
  // this point to see whether the feature is even configured.
  const secret = process.env.OPS_STATUS_SECRET;
  if (!secret) {
    return Response.json({ error: "ops summary is not configured" }, { status: 503 });
  }

  const authorized = checkCronSecret(
    request.headers.get("authorization"),
    request.headers.get("x-cron-secret"),
    secret,
  );
  if (!authorized) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await getOpsBacklogSummary();
  return Response.json(summary, {
    status: summary.status === "not_configured" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = handle;
export const POST = handle;
