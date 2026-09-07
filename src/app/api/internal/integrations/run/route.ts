import type { NextRequest } from "next/server";
import { checkCronSecret } from "@/lib/follow-ups/auth";
import { runIntegrationHub } from "@/lib/integrations/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin trigger for the Integration Hub worker (outbox fan-out + signed webhook
 * delivery with retry/backoff). Not public: requires the server-only
 * `INTEGRATION_HUB_CRON_SECRET` via `Authorization: Bearer <secret>` or an
 * `x-cron-secret` header — the same shape as the follow-up scheduler.
 *
 * Supports GET and POST so it works with cron systems that only issue GET.
 */
async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.INTEGRATION_HUB_CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "integration hub worker is not configured" },
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

  const summary = await runIntegrationHub();
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
