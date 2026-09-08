import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptEndpointSecret } from "@/lib/integrations/secret";
import { verifySignature, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/integrations/signature";
import { parseInboundRequest } from "@/lib/integrations/inbound-validation";
import { handleInboundAction } from "@/lib/integrations/inbound";
import { reportError } from "@/lib/observability/report";
import { BODY_LIMITS, bodyTooLargeResponse, readLimitedText } from "@/lib/security/body-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound action API for external automation systems (n8n, Make, a CRM, …).
 *
 * `POST /api/webhooks/integrations/<endpointId>` with:
 *   - `X-LeadFlow-Timestamp: <unix seconds>`
 *   - `X-LeadFlow-Signature: sha256=<HMAC-SHA256(secret, "<timestamp>.<raw body>")>`
 *   - JSON body: `{ id, action, leadId, ...params }`
 *
 * `action` is one of exactly three (`update_lead_status`, `create_follow_up`,
 * `request_human_handoff`) — nothing else can be driven. The organization is
 * resolved server-side from the endpoint; `leadId` is re-checked against it.
 * `id` is the idempotency key: a retry returns the first outcome.
 *
 * `route-policy` keeps `/api/webhooks/*` proxy-public — this route is its own
 * gate. No secret or signature is ever logged.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> },
): Promise<Response> {
  const { endpointId } = await params;
  const bodyResult = await readLimitedText(request, BODY_LIMITS.inboundAction);
  if (!bodyResult.ok) return bodyTooLargeResponse();
  const raw = bodyResult.text;

  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    return Response.json({ error: "integration hub is not configured" }, { status: 503 });
  }

  const { data: endpoint } = await db
    .from("integration_endpoints")
    .select("id, organization_id, secret_encrypted, enabled")
    .eq("id", endpointId)
    .maybeSingle();
  // Same generic 404 for "unknown" and "wrong shape" — don't leak existence.
  if (!endpoint) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // Per-endpoint rate limit (fail-open, like the public chat limiter).
  try {
    const { data: allowed } = await db.rpc("hit_rate_limit", {
      p_key: `integration_inbound:${endpointId}`,
      p_max: Number(process.env.INTEGRATION_INBOUND_RATE_LIMIT ?? 120),
      p_window_seconds: 60,
    });
    if (allowed === false) {
      return Response.json({ error: "rate limited" }, { status: 429 });
    }
  } catch {
    /* fail open */
  }

  let secret: string;
  try {
    secret = decryptEndpointSecret(endpoint.secret_encrypted);
  } catch {
    await reportError(new Error("endpoint secret unreadable"), {
      scope: "integrations.inbound",
    });
    return Response.json({ error: "endpoint misconfigured" }, { status: 500 });
  }

  const verdict = verifySignature({
    secret,
    body: raw,
    signatureHeader: request.headers.get(SIGNATURE_HEADER),
    timestampHeader: request.headers.get(TIMESTAMP_HEADER),
  });
  if (!verdict.ok) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  if (!endpoint.enabled) {
    return Response.json({ error: "endpoint disabled" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = parseInboundRequest(payload);
  if (!parsed.ok) {
    return Response.json({ status: "rejected", error_code: parsed.code }, { status: 400 });
  }

  try {
    const result = await handleInboundAction(db, {
      endpoint: { id: endpoint.id, organization_id: endpoint.organization_id },
      parsed: parsed.value,
    });
    return Response.json(result.body, { status: result.httpStatus });
  } catch (err) {
    await reportError(err, { scope: "integrations.inbound" });
    return Response.json({ status: "failed" }, { status: 500 });
  }
}
