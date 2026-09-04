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
): Promise<string> {
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
    return text || FALLBACK_REPLY;
  } catch (error) {
    console.error("reply generation failed:", error);
    return FALLBACK_REPLY;
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
  conversationId: string | null;
  requestId: string | null;
  externalContactId?: string | null;
  userProviderMessageId?: string | null;
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
  const { lead, proposedActions } = await extractLeadAndActions(
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
      source: input.channel === "web" ? "chat" : input.channel,
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
  }

  return { lead, conversationId, leadId, actions };
}
