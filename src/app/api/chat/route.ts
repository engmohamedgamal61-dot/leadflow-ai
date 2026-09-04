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
import { createAdminClient } from "@/lib/supabase/admin";
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
}

interface ParsedRequest {
  turns: ChatTurn[];
  /** Industry template slug, if the client requested a specific one. */
  industry: string | null;
  /** Conversation id from a previous turn, if continuing a chat. */
  conversationId: string | null;
  /** Per-turn idempotency key from the client. */
  requestId: string | null;
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

  return { turns, industry, conversationId, requestId };
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
  let json: unknown;
  try {
    json = await request.json();
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
  // the organization from the user's membership (the `industry` hint is
  // ignored — it cannot override org or industry). Anonymous requests keep the
  // dev/demo behavior: an `industry` hint selects a pre-seeded demo org.
  // `null` organization → the chat runs config-only with no persistence.
  const { organization, industryHintAllowed } = await resolveChatContext(
    parsed.industry,
  );
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
      createAdminClient(),
      organization?.organizationId ?? null,
    );
  } catch {
    availableSlots = undefined;
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
    console.error("chat stream error", error);
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
        console.error("chat stream error", error);
        controller.error(error);
        return;
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
