import type { NextRequest } from "next/server";
import { checkCronSecret } from "@/lib/follow-ups/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanupExpiredRateLimits } from "@/lib/security/rate-limit-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin trigger for `private.rate_limits` cleanup (garbage-collects stale
 * counters `hit_rate_limit` never deletes). Not public: requires the
 * server-only `RATE_LIMIT_CLEANUP_CRON_SECRET` via `Authorization: Bearer
 * <secret>` or an `x-cron-secret` header — the same shape as the follow-up
 * scheduler and the Integration Hub worker.
 *
 * Supports GET and POST so it works with cron systems that only issue GET.
 */
async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.RATE_LIMIT_CLEANUP_CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "rate-limit cleanup is not configured" },
      { status: 503 },
    );
  }

  const authorized = checkCronSecret(
    request.headers.get("authorization"),
    request.headers.get("x-cron-secret"),
    secret,
  );
  if (!authorized) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    return Response.json({ error: "not configured" }, { status: 503 });
  }

  const summary = await cleanupExpiredRateLimits(db);
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
