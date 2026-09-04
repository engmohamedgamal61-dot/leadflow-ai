import type { NextRequest } from "next/server";
import { checkCronSecret } from "@/lib/follow-ups/auth";
import { runFollowUpScheduler } from "@/lib/follow-ups/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin trigger for the follow-up scheduler engine. Not public: it requires the
 * server-only `FOLLOW_UP_CRON_SECRET` via `Authorization: Bearer <secret>` or
 * an `x-cron-secret` header. A platform cron (Vercel Cron, Supabase Cron, an
 * external scheduler) is expected to call this; the browser and dashboard
 * never do.
 *
 * Supports GET and POST so it works with cron systems that only issue GET.
 */
async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.FOLLOW_UP_CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "scheduler is not configured" },
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

  const summary = await runFollowUpScheduler();
  return Response.json(summary, {
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = handle;
export const POST = handle;
