import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  CHAT_MODEL,
  MAX_TOKENS,
  getAnthropicClient,
} from "@/lib/chat/anthropic";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { extractLead } from "@/lib/chat/lead-extraction";
import { getEffectiveConfig, hasIndustryTemplate } from "@/lib/config";
import { calculateLeadScore } from "@/lib/lead-scoring";
import { resolveDevOrganization } from "@/lib/org/resolve";
import { persistCompletedTurn } from "@/lib/persistence/chat";
import { EMPTY_LEAD, LEAD_DELIMITER, type ChatTurn } from "@/types/chat";

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
      { error: "The assistant is misconfigured. Check ANTHROPIC_API_KEY." },
      { status: 502 },
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return Response.json(
      { error: "The assistant is busy right now. Please try again shortly." },
      { status: 429 },
    );
  }
  if (error instanceof Anthropic.APIError) {
    return Response.json(
      { error: "The assistant is temporarily unavailable." },
      { status: 502 },
    );
  }
  return Response.json({ error: "Unexpected server error." }, { status: 500 });
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseBody(json);
  if (!parsed) {
    return Response.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const messages = toAnthropicMessages(parsed.turns);
  if (messages.length === 0) {
    return Response.json(
      { error: "Conversation must include a user message." },
      { status: 400 },
    );
  }

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch {
    return Response.json(
      { error: "The assistant is not configured. Set ANTHROPIC_API_KEY." },
      { status: 503 },
    );
  }

  // Resolve the organization this chat belongs to. Dev/demo only for now — a
  // `?industry=` hint selects a pre-seeded demo org; production will resolve it
  // from the authenticated user's membership. `null` when Supabase isn't
  // configured, in which case the chat runs config-only with no persistence.
  const organization = await resolveDevOrganization(parsed.industry);

  // The AI engine runs on the effective configuration. The organization's
  // `industry_template_id` is the source of truth when we have one; otherwise
  // fall back to the client's industry hint (dev without a database).
  const config = getEffectiveConfig(
    organization
      ? {
          organizationId: organization.organizationId,
          industryTemplateId: organization.industryTemplateId,
        }
      : parsed.industry
        ? { organizationId: "request", industryTemplateId: parsed.industry }
        : null,
  );

  // Thinking disabled: a lead-qualification chat is a low-complexity task and
  // real-time responsiveness matters more than deliberation.
  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(config),
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

      // Second pass: extract structured lead data from the full conversation
      // (history + the reply we just produced). Extraction failure never breaks
      // the chat — it yields an empty lead and the client keeps its last value.
      let lead = EMPTY_LEAD;
      try {
        lead = await extractLead(
          client,
          [...messages, { role: "assistant", content: replyText }],
          config,
        );
      } catch (error) {
        console.error("lead extraction error", error);
      }

      // Persist the completed turn (lead + conversation + messages + events)
      // when we have an organization. `persistCompletedTurn` never throws — a
      // database failure is logged server-side and the AI response continues.
      let conversationId = parsed.conversationId;
      if (organization) {
        const lastUserMessage =
          [...parsed.turns].reverse().find((turn) => turn.role === "user")
            ?.content ?? "";
        const { score, temperature } = calculateLeadScore(lead, config.scoring);
        const persisted = await persistCompletedTurn({
          organizationId: organization.organizationId,
          conversationId: parsed.conversationId,
          requestId: parsed.requestId,
          channel: "web",
          source: "chat",
          userMessage: lastUserMessage,
          assistantMessage: replyText,
          lead,
          score,
          temperature,
        });
        if (persisted) conversationId = persisted.conversationId;
      }

      controller.enqueue(
        encoder.encode(
          LEAD_DELIMITER + JSON.stringify({ lead, conversationId }),
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
