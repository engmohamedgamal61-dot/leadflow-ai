import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  CHAT_MODEL,
  MAX_TOKENS,
  getAnthropicClient,
} from "@/lib/chat/anthropic";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import {
  finalizeConversationTurn,
  getAvailabilityForPrompt,
} from "@/lib/chat/conversation-service";
import { getEffectiveConfig, hasIndustryTemplate } from "@/lib/config";
import { loadEffectiveConfig } from "@/lib/config/organization-config.server";
import { resolveChatContext } from "@/lib/org/chat-organization";
import { widgetOriginCandidate } from "@/lib/org/widget-origin";
import { appBaseUrlOrNull } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp } from "@/lib/security/client-ip";
import { enforceRateLimit, chatIpRule, chatOrgRule } from "@/lib/security/rate-limit";
import { reportError } from "@/lib/observability/report";
import { checkUsageAllowed } from "@/lib/metering/enforcement";
import { normalizeAnthropicUsage } from "@/lib/metering/types";
import { BODY_LIMITS, bodyTooLargeResponse, readLimitedText } from "@/lib/security/body-limit";
import { LEAD_DELIMITER, type ChatTurn } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGES = 100;
const MAX_CONTENT_LENGTH = 4000;

const FALLBACK_REPLIES = {
  refusal:
    "I'm sorry, I can't help with that — could we get back to what you're looking for?",
  empty: "Sorry, I didn't quite catch that. Could you rephrase?",
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ChatRequestBody {
  messages: ChatTurn[];
  industry?: string;
  conversationId?: string;
  requestId?: string;
  widgetKey?: string;
  pageOrigin?: string;
}

interface ParsedRequest {
  turns: ChatTurn[];
  /** Industry template slug, if the client requested a specific one. */
  industry: string | null;
  /** Conversation id from a previous turn, if continuing a chat. */
  conversationId: string | null;
  /** Per-turn idempotency key from the client. */
  requestId: string | null;
  /** Per-organization website widget key, if the turn came from an embed. */
  widgetKey: string | null;
  /** The embedding page origin the widget script reported (best-effort). */
  pageOrigin: string | null;
}

function parseBody(body: unknown): ParsedRequest | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as ChatRequestBody).messages)
  ) {
    return null;
  }

  const raw = (body as ChatRequestBody).messages;
  if (raw.length === 0 || raw.length > MAX_MESSAGES) return null;

  const turns: ChatTurn[] = [];
  for (const turn of raw) {
    if (
      typeof turn !== "object" ||
      turn === null ||
      (turn.role !== "user" && turn.role !== "assistant") ||
      typeof turn.content !== "string" ||
      turn.content.trim().length === 0 ||
      turn.content.length > MAX_CONTENT_LENGTH
    ) {
      return null;
    }
    turns.push({ role: turn.role, content: turn.content });
  }

  const industryRaw = (body as ChatRequestBody).industry;
  const industry =
    typeof industryRaw === "string" && hasIndustryTemplate(industryRaw)
      ? industryRaw
      : null;

  const conversationIdRaw = (body as ChatRequestBody).conversationId;
  const conversationId =
    typeof conversationIdRaw === "string" && UUID_RE.test(conversationIdRaw)
      ? conversationIdRaw
      : null;

  const requestIdRaw = (body as ChatRequestBody).requestId;
  const requestId =
    typeof requestIdRaw === "string" && UUID_RE.test(requestIdRaw)
      ? requestIdRaw
      : null;

  const widgetKeyRaw = (body as ChatRequestBody).widgetKey;
  const widgetKey =
    typeof widgetKeyRaw === "string" && UUID_RE.test(widgetKeyRaw)
      ? widgetKeyRaw
      : null;

  const pageOriginRaw = (body as ChatRequestBody).pageOrigin;
  const pageOrigin =
    typeof pageOriginRaw === "string" && pageOriginRaw.length <= 2048
      ? pageOriginRaw
      : null;

  return { turns, industry, conversationId, requestId, widgetKey, pageOrigin };
}

/** The Messages API requires the conversation to start with a user turn. */
function toAnthropicMessages(turns: ChatTurn[]): Anthropic.MessageParam[] {
  const firstUser = turns.findIndex((turn) => turn.role === "user");
  if (firstUser === -1) return [];
  return turns.slice(firstUser).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
}

function errorResponse(error: unknown) {
  if (error instanceof Anthropic.AuthenticationError) {
    return Response.json(
      { errorCode: "chat.errors.misconfigured" },
      { status: 502 },
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return Response.json(
      { errorCode: "chat.errors.busy" },
      { status: 429 },
    );
  }
  if (error instanceof Anthropic.APIError) {
    return Response.json(
      { errorCode: "chat.errors.unavailable" },
      { status: 502 },
    );
  }
  return Response.json({ errorCode: "chat.errors.serverError" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const bodyResult = await readLimitedText(request, BODY_LIMITS.chat);
  if (!bodyResult.ok) return bodyTooLargeResponse();

  let json: unknown;
  try {
    json = JSON.parse(bodyResult.text);
  } catch {
    return Response.json({ errorCode: "chat.errors.invalidRequest" }, { status: 400 });
  }

  const parsed = parseBody(json);
  if (!parsed) {
    return Response.json({ errorCode: "chat.errors.invalidRequest" }, { status: 400 });
  }

  const messages = toAnthropicMessages(parsed.turns);
  if (messages.length === 0) {
    return Response.json(
      { errorCode: "chat.errors.invalidRequest" },
      { status: 400 },
    );
  }

  // Rate limiting — protects the Anthropic budget on this public endpoint.
  // Per-IP burst + a coarser per-widget/per-demo hourly cap. Skipped only when
  // Supabase isn't configured (no DB to persist against anyway). Fails open.
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }
  if (admin) {
    const ip = clientIp(request.headers);
    const ipCheck = await enforceRateLimit(admin, chatIpRule(ip));
    const scopeKey = parsed.widgetKey ?? `demo:${parsed.industry ?? "default"}`;
    const orgCheck = ipCheck.allowed
      ? await enforceRateLimit(admin, chatOrgRule(scopeKey))
      : { allowed: false, retryAfterSeconds: ipCheck.retryAfterSeconds };
    if (!ipCheck.allowed || !orgCheck.allowed) {
      const retryAfter = Math.max(ipCheck.retryAfterSeconds, orgCheck.retryAfterSeconds, 1);
      return Response.json(
        { errorCode: "chat.errors.busy" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch {
    return Response.json(
      { errorCode: "chat.errors.notConfigured" },
      { status: 503 },
    );
  }

  // Resolve the organization this chat belongs to. Authenticated requests use
  // the organization from the user's membership (the `industry`/`widgetKey`
  // hints are ignored). A `widgetKey` from an embedded widget resolves the
  // customer's own org server-side. Otherwise the dev/demo behavior stands: an
  // `industry` hint selects a pre-seeded demo org. `null` organization → the
  // chat runs config-only with no persistence.
  const { organization, industryHintAllowed, widgetOriginBlocked } =
    await resolveChatContext({
      industryHint: parsed.industry,
      widgetKey: parsed.widgetKey,
      widgetOrigin: parsed.widgetKey
        ? widgetOriginCandidate({
            originHeader: request.headers.get("origin"),
            refererHeader: request.headers.get("referer"),
            declared: parsed.pageOrigin,
            appOrigin: appBaseUrlOrNull(),
          })
        : null,
    });

  // A widget key that resolved to a real org, but from a site the org hasn't
  // authorized: reject. Never fall through to the demo org or a config-only chat.
  if (widgetOriginBlocked) {
    return Response.json(
      { errorCode: "chat.errors.originBlocked" },
      { status: 403 },
    );
  }

  const hintSlug = industryHintAllowed ? parsed.industry : null;

  // The AI engine runs on one EffectiveConfig. For an authenticated member it
  // is `IndustryTemplate + stored organization overrides` (system prompt,
  // extraction, qualification flow and scoring all consume the same object).
  // The anonymous/demo path is unchanged: template defaults, optionally the
  // industry hint. `loadEffectiveConfig` falls back to template defaults if the
  // stored overrides are missing or invalid.
  const config =
    organization && organization.source === "member"
      ? await loadEffectiveConfig(
          organization.organizationId,
          organization.industryTemplateId,
        )
      : getEffectiveConfig(
          organization
            ? {
                organizationId: organization.organizationId,
                industryTemplateId: organization.industryTemplateId,
              }
            : hintSlug
              ? { organizationId: "request", industryTemplateId: hintSlug }
              : null,
        );

  // Real appointment availability, if a calendar is connected — one data
  // lookup (not an extra Anthropic call) so the AI can never invent a slot.
  // Reading it needs the service-role client (same trust boundary as
  // decrypting a WhatsApp access token): the tokens are revoked from
  // `authenticated` at the database level.
  let availableSlots: Awaited<ReturnType<typeof getAvailabilityForPrompt>>;
  try {
    availableSlots = await getAvailabilityForPrompt(
      admin ?? createAdminClient(),
      organization?.organizationId ?? null,
    );
  } catch {
    availableSlots = undefined;
  }

  // Usage-limit gate — deterministic, BEFORE the Anthropic call. A no-op unless
  // this org has a hard monthly limit enabled and has exceeded it. Fails open
  // on any error (mirrors the rate limiter) so metering never takes chat
  // offline, and is skipped entirely for the anonymous/demo path (no org).
  if (organization?.organizationId) {
    const gate = await checkUsageAllowed(organization.organizationId, {
      db: admin ?? undefined,
    });
    if (!gate.allowed) {
      return Response.json(
        { errorCode: "chat.errors.usageLimitReached" },
        { status: 429 },
      );
    }
  }

  // Thinking disabled: a lead-qualification chat is a low-complexity task and
  // real-time responsiveness matters more than deliberation.
  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(config, { availableSlots }),
    thinking: { type: "disabled" },
    messages,
  });

  const events = stream[Symbol.asyncIterator]();

  // Consume events up to the first text delta before committing a response.
  // This lets auth / rate-limit / validation errors surface with a proper
  // status code instead of a truncated 200 stream.
  let firstChunk: string | null = null;
  try {
    while (firstChunk === null) {
      const { value: event, done } = await events.next();
      if (done) break;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        firstChunk = event.delta.text;
      }
    }
  } catch (error) {
    void reportError(error, {
      scope: "chat.route",
      channel: "web",
      orgSource: organization?.source ?? "none",
    });
    stream.abort();
    return errorResponse(error);
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let replyText = "";
      try {
        if (firstChunk === null) {
          const final = await stream.finalMessage();
          replyText =
            final.stop_reason === "refusal"
              ? FALLBACK_REPLIES.refusal
              : FALLBACK_REPLIES.empty;
          controller.enqueue(encoder.encode(replyText));
        } else {
          replyText = firstChunk;
          controller.enqueue(encoder.encode(firstChunk));
          while (true) {
            const { value: event, done } = await events.next();
            if (done) break;
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              replyText += event.delta.text;
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        }
      } catch (error) {
        void reportError(error, { scope: "chat.route", phase: "stream", channel: "web" });
        controller.error(error);
        return;
      }

      // The completed message carries this reply call's own token usage — for
      // cost metering, recorded once in `finalizeConversationTurn`. Not an
      // extra request; `null` if the stream can't produce a final message.
      let replyUsage: ReturnType<typeof normalizeAnthropicUsage> | null = null;
      try {
        replyUsage = normalizeAnthropicUsage((await stream.finalMessage()).usage);
      } catch {
        replyUsage = null;
      }

      // Second pass — shared by every channel: ONE structured-output call
      // (extraction + proposed actions, not an extra request), deterministic
      // scoring, persistence, and agent-action execution. Never throws.
      const lastUserMessage =
        [...parsed.turns].reverse().find((turn) => turn.role === "user")
          ?.content ?? "";
      const { lead, conversationId, actions } = await finalizeConversationTurn({
        client,
        config,
        organizationId: organization?.organizationId ?? null,
        historyMessages: messages,
        replyText,
        replyUsage,
        userMessage: lastUserMessage,
        channel: "web",
        conversationId: parsed.conversationId,
        requestId: parsed.requestId,
      });

      controller.enqueue(
        encoder.encode(
          LEAD_DELIMITER + JSON.stringify({ lead, conversationId, actions }),
        ),
      );
      controller.close();
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
