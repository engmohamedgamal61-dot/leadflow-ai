import { type NextRequest, after } from "next/server";
import { getAnthropicClient } from "@/lib/chat/anthropic";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookChallenge, verifySignature } from "@/lib/whatsapp/signature";
import { parseWhatsAppWebhook } from "@/lib/whatsapp/payload";
import { resolveOrgByPhoneNumberId } from "@/lib/whatsapp/connections";
import { processInboundWhatsAppMessage } from "@/lib/whatsapp/inbound";
import { applyStatusUpdate } from "@/lib/whatsapp/status";
import { reportError } from "@/lib/observability/report";
import { logEvent } from "@/lib/observability/log";
import { BODY_LIMITS, bodyTooLargeResponse, readLimitedText } from "@/lib/security/body-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * GET  — verification handshake (`hub.mode` / `hub.verify_token` / `hub.challenge`).
 * POST — inbound messages + delivery statuses. The `X-Hub-Signature-256`
 *        signature is verified against the RAW body before anything is parsed,
 *        persisted, or sent to the AI. Heavy work runs in `after()` so Meta
 *        gets a fast 200 (its retries are deduped by provider message id).
 *
 * `route-policy` keeps `/api/webhooks/*` proxy-public — this route is its own
 * gate. No secret is ever logged.
 */

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const challenge = verifyWebhookChallenge(
    {
      mode: url.searchParams.get("hub.mode"),
      token: url.searchParams.get("hub.verify_token"),
      challenge: url.searchParams.get("hub.challenge"),
    },
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  );
  if (challenge === null) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const bodyResult = await readLimitedText(request, BODY_LIMITS.webhook);
  if (!bodyResult.ok) return bodyTooLargeResponse();
  const raw = bodyResult.text;

  if (
    !verifySignature(
      raw,
      request.headers.get("x-hub-signature-256"),
      process.env.WHATSAPP_APP_SECRET,
    )
  ) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = parseWhatsAppWebhook(payload);
  if (!parsed.phoneNumberId) {
    // Authentic but nothing actionable (e.g. a template-status change).
    return Response.json({ ok: true });
  }

  // Ack immediately; process off the response path. `requestId` here is a
  // log-correlation id for this webhook delivery batch — distinct from the
  // per-message `requestId` (`uuidFromProviderId`, in `inbound.ts`) that
  // persistence/metering actually key on.
  const requestId = crypto.randomUUID();
  after(async () => {
   try {
    const started = Date.now();
    let db: ReturnType<typeof createAdminClient>;
    try {
      db = createAdminClient();
    } catch {
      console.error("[whatsapp] webhook: Supabase not configured");
      return;
    }

    const phoneNumberId = parsed.phoneNumberId as string;
    const resolved = await resolveOrgByPhoneNumberId(db, phoneNumberId);

    let processed = 0;
    let skipped = 0;

    // Defence in depth: a real Meta batch is a handful of messages. Cap it so a
    // pathological (or replayed-with-a-leaked-secret) payload can't fan out into
    // an unbounded number of Anthropic calls. The body-size limit already bounds
    // the payload; this bounds the work.
    const inbound = parsed.messages.slice(0, 50);
    if (inbound.length > 0) {
      let anthropic: ReturnType<typeof getAnthropicClient>;
      try {
        anthropic = getAnthropicClient();
      } catch {
        console.error("[whatsapp] webhook: ANTHROPIC_API_KEY not configured");
        return;
      }
      for (const message of inbound) {
        const r = await processInboundWhatsAppMessage(phoneNumberId, message, {
          db,
          anthropic,
        });
        if (r.status === "processed" || r.status === "unsupported") processed += 1;
        else skipped += 1;
      }
    }

    if (parsed.statuses.length > 0 && resolved) {
      for (const status of parsed.statuses) {
        const r = await applyStatusUpdate(db, resolved.organizationId, status);
        if (r === "applied") processed += 1;
        else skipped += 1;
      }
    }

    logEvent({
      event: "whatsapp.webhook.batch",
      requestId,
      processed,
      skipped,
      durationMs: Date.now() - started,
    });
   } catch (err) {
     await reportError(err, { scope: "whatsapp.webhook", requestId });
   }
  });

  return Response.json({ ok: true });
}
