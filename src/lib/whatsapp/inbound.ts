/**
 * Process ONE normalised inbound WhatsApp message:
 *   dedup → resolve org → build history → AI turn (shared service) → send reply.
 *
 * The AI engine, extraction, scoring, qualification, agent actions and
 * persistence are exactly the web-chat path (`conversation-service`). The only
 * WhatsApp-specific parts are: the provider-message-id dedup, org resolution
 * from `phone_number_id`, and the outbound send.
 *
 * All deps are injected so the webhook route wires the real ones and tests
 * wire fakes. Never throws.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { EffectiveConfig } from "@/lib/config";
import { loadEffectiveConfig } from "@/lib/config/organization-config.server";
import {
  generateAssistantReply,
  finalizeConversationTurn,
} from "@/lib/chat/conversation-service";
import { resolveOrgByPhoneNumberId, getSendCredentials } from "./connections.ts";
import { getMetaTransport, buildTextMessage, type MetaTransport } from "./meta-client.ts";
import { uuidFromProviderId } from "./ids.ts";
import type { NormalizedInboundMessage } from "./payload.ts";

type Db = SupabaseClient<Database>;

export interface ProcessInboundDeps {
  db: Db;
  anthropic: Anthropic;
  transport?: MetaTransport;
  loadConfig?: (orgId: string, tplId: string) => Promise<EffectiveConfig>;
}

export interface ProcessInboundResult {
  status: "processed" | "duplicate" | "ignored" | "unsupported" | "error";
  detail?: string;
}

const HISTORY_LIMIT = 20;
const UNSUPPORTED_REPLY =
  "Thanks! I can only read text messages right now — could you type your question?";

export async function processInboundWhatsAppMessage(
  phoneNumberId: string,
  message: NormalizedInboundMessage,
  deps: ProcessInboundDeps,
): Promise<ProcessInboundResult> {
  const { db, anthropic } = deps;
  const transport = deps.transport ?? getMetaTransport();
  const loadConfig = deps.loadConfig ?? loadEffectiveConfig;

  // 1. Resolve organization from the trusted Meta identifier only.
  const resolved = await resolveOrgByPhoneNumberId(db, phoneNumberId);
  if (!resolved) {
    console.warn(
      `[whatsapp] inbound for unknown/unconfigured phone_number_id (skipped)`,
    );
    return { status: "ignored", detail: "no connection" };
  }
  const { organizationId, industryTemplateId } = resolved;

  // 2. Idempotency: one row per provider message id. A concurrent duplicate
  //    loses the PK insert and stops here.
  const claim = await db
    .from("whatsapp_inbound_events")
    .upsert(
      { provider_message_id: message.providerMessageId, organization_id: organizationId },
      { onConflict: "provider_message_id", ignoreDuplicates: true },
    )
    .select("provider_message_id");
  if (claim.error) {
    console.error("[whatsapp] inbound dedup insert failed:", claim.error.message);
    return { status: "error", detail: "dedup failed" };
  }
  if (!claim.data || claim.data.length === 0) {
    return { status: "duplicate" };
  }

  const waId = message.from;
  const requestId = uuidFromProviderId(message.providerMessageId);

  // 3. Unsupported types: record the inbound, send a short canned reply, stop.
  if (!message.supported) {
    const placeholder = `[received a ${message.type} message — unsupported]`;
    await finalizeConversationTurn({
      client: anthropic,
      config: await loadConfig(organizationId, industryTemplateId),
      organizationId,
      historyMessages: [{ role: "user", content: placeholder }],
      replyText: UNSUPPORTED_REPLY,
      userMessage: placeholder,
      channel: "whatsapp",
      conversationId: null,
      requestId,
      externalContactId: waId,
      userProviderMessageId: message.providerMessageId,
    });
    await sendReply(db, transport, organizationId, null, waId, UNSUPPORTED_REPLY);
    return { status: "unsupported" };
  }

  // 4. Load the org's effective config (industry template + Phase E overrides).
  const config = await loadConfig(organizationId, industryTemplateId);

  // 5. Build the AI history from this contact's prior messages.
  const history = await loadHistory(db, organizationId, waId);
  const historyMessages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: message.text as string },
  ];

  // 6. Generate the reply (non-streaming) — same engine, one call.
  const replyText = await generateAssistantReply(anthropic, config, historyMessages);

  // 7. Persist + extraction + scoring + agent actions (shared, one more call).
  const { conversationId } = await finalizeConversationTurn({
    client: anthropic,
    config,
    organizationId,
    historyMessages,
    replyText,
    userMessage: message.text as string,
    channel: "whatsapp",
    conversationId: null,
    requestId,
    externalContactId: waId,
    userProviderMessageId: message.providerMessageId,
  });

  // 8. Send the reply and record its provider message id / delivery status.
  await sendReply(db, transport, organizationId, conversationId, waId, replyText);

  return { status: "processed", detail: conversationId ?? undefined };
}

async function loadHistory(
  db: Db,
  organizationId: string,
  waId: string,
): Promise<Anthropic.MessageParam[]> {
  const conv = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("channel", "whatsapp")
    .eq("external_contact_id", waId)
    .maybeSingle();
  if (!conv.data) return [];

  const { data } = await db
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conv.data.id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  return (data ?? [])
    .reverse()
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));
}

async function sendReply(
  db: Db,
  transport: MetaTransport,
  organizationId: string,
  conversationId: string | null,
  waId: string,
  text: string,
): Promise<void> {
  const creds = await getSendCredentials(db, organizationId);
  if (!creds) {
    console.error(`[whatsapp] cannot send reply — no credentials for org`);
    return;
  }
  const result = await transport.send({
    phoneNumberId: creds.phoneNumberId,
    accessToken: creds.accessToken,
    body: buildTextMessage(waId, text),
    apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION,
  });

  if (!conversationId) return;

  if (result.ok) {
    await db
      .from("messages")
      .update({
        provider_message_id: result.providerMessageId ?? null,
        delivery_status: "sent",
        provider: "meta_cloud",
      })
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .eq("content", text)
      .is("provider_message_id", null);
  } else {
    await db
      .from("messages")
      .update({ delivery_status: "failed", provider: "meta_cloud" })
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .eq("content", text)
      .is("provider_message_id", null);
    console.error(
      `[whatsapp] reply send failed: meta ${result.errorCode ?? "?"}`,
    );
  }
}
