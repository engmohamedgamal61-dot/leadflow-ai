/**
 * The generic server-side conversation engine, shared by every channel.
 *
 *        Web chat  ┐
 *                  ├──►  conversation-service  ──►  extraction / scoring /
 *        WhatsApp  ┘        (this module)            actions / persistence
 *
 * `/api/chat` still owns the streaming transport (it calls
 * `finalizeConversationTurn` for the post-reply work); the WhatsApp webhook
 * calls `generateAssistantReply` + `finalizeConversationTurn`. Nothing here is
 * channel-specific beyond a `channel` string passed straight through to
 * persistence.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_MODEL, MAX_TOKENS } from "@/lib/chat/anthropic";
import { buildSystemPrompt, type AvailableSlot } from "@/lib/chat/system-prompt";
import { extractLeadAndActions } from "@/lib/chat/agent-extraction";
import type { EffectiveConfig } from "@/lib/config";
import { calculateLeadScore } from "@/lib/lead-scoring";
import { isQualificationComplete } from "@/lib/agent/qualification";
import { runChatAgentActions } from "@/lib/agent/chat-actions";
import { persistCompletedTurn } from "@/lib/persistence/chat";
import { getAvailability } from "@/lib/calendar/service";
import { recordAiUsage } from "@/lib/metering/service";
import { normalizeAnthropicUsage } from "@/lib/metering/types";
import type { TokenUsage } from "@/lib/metering/pricing";
import type { Database } from "@/lib/supabase/types";

const FALLBACK_REPLY =
  "Thanks for your message. Could you tell me a bit more about what you're looking for?";

/**
 * Real, provider-backed appointment availability for the system prompt —
 * shared by every channel so the AI is shown the exact same real slots
 * regardless of where the conversation is happening. `undefined` (no
 * organization, no connected calendar, or the lookup failed) means the
 * prompt won't mention appointments at all. Never throws.
 */
export async function getAvailabilityForPrompt(
  db: SupabaseClient<Database>,
  organizationId: string | null,
  now: Date = new Date(),
): Promise<AvailableSlot[] | undefined> {
  if (!organizationId) return undefined;
  try {
    const slots = await getAvailability(db, organizationId, now);
    return slots ?? undefined;
  } catch (error) {
    console.error("calendar availability lookup failed:", error);
    return undefined;
  }
}

export interface AssistantReply {
  text: string;
  /**
   * Token usage for this reply call, for cost metering. `null` on failure or
   * when the client returned no usage. Not an extra request — the same call's
   * own `response.usage`.
   */
  usage: TokenUsage | null;
  model: string;
}

/**
 * Non-streaming reply generation — for channels without a stream (WhatsApp).
 * `messages` is the full Anthropic history (must start with a user turn).
 * Never throws: returns a safe fallback on any error.
 */
export async function generateAssistantReply(
  client: Anthropic,
  config: EffectiveConfig,
  messages: Anthropic.MessageParam[],
  availableSlots?: AvailableSlot[],
): Promise<AssistantReply> {
  try {
    const response = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(config, { availableSlots }),
      thinking: { type: "disabled" },
      messages,
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return {
      text: text || FALLBACK_REPLY,
      usage: normalizeAnthropicUsage(response.usage),
      model: CHAT_MODEL,
    };
  } catch (error) {
    console.error("reply generation failed:", error);
    return { text: FALLBACK_REPLY, usage: null, model: CHAT_MODEL };
  }
}

export interface FinalizeTurnInput {
  client: Anthropic;
  config: EffectiveConfig;
  organizationId: string | null;
  /** Anthropic history for this turn, INCLUDING the latest user message. */
  historyMessages: Anthropic.MessageParam[];
  /** The reply already produced (streamed by the web route, generated here for WhatsApp). */
  replyText: string;
  /** The raw latest user message (for persistence). */
  userMessage: string;
  channel: string;
  /**
   * Lead `source` for a newly created lead. Defaults to `"chat"` for the web
   * channel and the channel name otherwise. The website widget passes
   * `"widget"` so its leads are attributed distinctly.
   */
  source?: string | null;
  conversationId: string | null;
  requestId: string | null;
  externalContactId?: string | null;
  userProviderMessageId?: string | null;
  /**
   * Token usage of the reply call that produced `replyText`, for cost metering
   * — from the web route's `stream.finalMessage()` or WhatsApp's
   * `generateAssistantReply`. `null`/omitted → no reply usage recorded (the
   * extraction call below is still metered). Never triggers an extra request.
   */
  replyUsage?: TokenUsage | null;
  /** Model used for the reply call (defaults to the chat model). */
  replyModel?: string;
}

export interface FinalizeTurnResult {
  lead: import("@/types/chat").LeadData;
  conversationId: string | null;
  leadId: string | null;
  actions: unknown[];
}

/**
 * The post-reply work: ONE structured-output call (extraction + proposed
 * actions — not an extra request), deterministic scoring, persistence, and
 * agent-action execution. Identical for every channel. Never throws.
 */
export async function finalizeConversationTurn(
  input: FinalizeTurnInput,
): Promise<FinalizeTurnResult> {
  const {
    lead,
    proposedActions,
    usage: extractionUsage,
    model: extractionModel,
  } = await extractLeadAndActions(
    input.client,
    [...input.historyMessages, { role: "assistant", content: input.replyText }],
    input.config,
  );

  let conversationId = input.conversationId;
  let leadId: string | null = null;
  let actions: unknown[] = [];

  if (input.organizationId) {
    const { score, temperature } = calculateLeadScore(lead, input.config.scoring);
    const persisted = await persistCompletedTurn({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      requestId: input.requestId,
      channel: input.channel,
      source:
        input.source ?? (input.channel === "web" ? "chat" : input.channel),
      userMessage: input.userMessage,
      assistantMessage: input.replyText,
      lead,
      score,
      temperature,
      externalContactId: input.externalContactId ?? null,
      userProviderMessageId: input.userProviderMessageId ?? null,
    });
    if (persisted) {
      conversationId = persisted.conversationId;
      leadId = persisted.leadId;
      actions = await runChatAgentActions({
        organizationId: input.organizationId,
        leadId: persisted.leadId,
        conversationId: persisted.conversationId,
        requestId: input.requestId,
        markQualified: isQualificationComplete(lead, input.config),
        proposedActions,
      });
    }

    // Cost metering — the single per-channel point where an org's Anthropic
    // usage is recorded. Both calls' `usage` objects are already in hand; this
    // adds NO request. Never throws (recordAiUsage swallows its own errors).
    if (input.replyUsage) {
      await recordAiUsage({
        organizationId: input.organizationId,
        requestType: "chat_reply",
        model: input.replyModel ?? extractionModel,
        channel: input.channel,
        usage: input.replyUsage,
        conversationId,
        leadId,
        requestId: input.requestId,
      });
    }
    if (extractionUsage) {
      await recordAiUsage({
        organizationId: input.organizationId,
        requestType: "lead_extraction",
        model: extractionModel,
        channel: input.channel,
        usage: extractionUsage,
        conversationId,
        leadId,
        requestId: input.requestId,
      });
    }
  }

  return { lead, conversationId, leadId, actions };
}
