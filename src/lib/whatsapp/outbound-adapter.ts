/**
 * `WhatsAppFollowUpChannelAdapter` — the Phase G follow-up channel adapter for
 * Meta WhatsApp Cloud API. The scheduler / executor know nothing about Meta:
 * they call `deliver(ctx)` and get a normalised `FollowUpDeliveryResult`.
 *
 * Responsibilities: resolve the org's credentials + recipient (server-side),
 * pick free-form vs template per the 24-hour session window, send via the
 * injected transport, persist the outbound message, and classify the result.
 */

import type {
  FollowUpChannelAdapter,
  FollowUpDeliveryContext,
  FollowUpDeliveryResult,
} from "../follow-ups/channels.ts";
import {
  getMetaTransport,
  buildTextMessage,
  buildTemplateMessage,
  type MetaTransport,
} from "./meta-client.ts";
import { getSendCredentials, resolveRecipientWaId } from "./connections.ts";
import { graphApiVersion, isWithinSessionWindow } from "./config.ts";

function fail(retryable: boolean, detail: string): FollowUpDeliveryResult {
  return { ok: false, retryable, detail };
}

export function createWhatsAppAdapter(
  opts: { transport?: MetaTransport } = {},
): FollowUpChannelAdapter {
  return {
    name: "whatsapp",
    async deliver(ctx: FollowUpDeliveryContext): Promise<FollowUpDeliveryResult> {
      const transport = opts.transport ?? getMetaTransport();

      // Demo orgs never send externally (the executor also forces `internal`).
      if (ctx.isDemo) {
        return fail(false, "demo organizations do not send WhatsApp");
      }

      const creds = await getSendCredentials(ctx.db, ctx.organizationId);
      if (!creds) {
        return fail(false, "WhatsApp is not connected for this organization");
      }

      const recipient = await resolveRecipientWaId(
        ctx.db,
        ctx.organizationId,
        ctx.conversationId,
        ctx.leadId,
      );
      if (!recipient) {
        return fail(false, "no WhatsApp number for this lead");
      }

      // 24-hour customer-service window: free-form is only allowed inside it.
      let lastInboundAt: string | null = null;
      if (ctx.conversationId) {
        const { data } = await ctx.db
          .from("conversations")
          .select("last_inbound_at")
          .eq("organization_id", ctx.organizationId)
          .eq("id", ctx.conversationId)
          .maybeSingle();
        lastInboundAt = data?.last_inbound_at ?? null;
      }
      const inWindow = isWithinSessionWindow(lastInboundAt);

      let body: Record<string, unknown>;
      if (inWindow) {
        body = buildTextMessage(recipient, ctx.message);
      } else if (creds.followUpTemplate) {
        body = buildTemplateMessage(
          recipient,
          creds.followUpTemplate.name,
          creds.followUpTemplate.language,
        );
      } else {
        // Outside the window and no template — do NOT attempt an invalid send.
        return fail(
          false,
          "outside the 24-hour window and no follow-up template is configured",
        );
      }

      const result = await transport.send({
        phoneNumberId: creds.phoneNumberId,
        accessToken: creds.accessToken,
        body,
        apiVersion: graphApiVersion(process.env.WHATSAPP_GRAPH_API_VERSION),
      });

      if (!result.ok) {
        return {
          ok: false,
          retryable: result.retryable,
          detail: `meta ${result.errorCode ?? "?"}: ${result.errorDetail ?? "send failed"}`.slice(0, 300),
        };
      }

      // Persist the outbound message so it shows in the conversation thread.
      if (ctx.conversationId) {
        const { error } = await ctx.db.from("messages").insert({
          conversation_id: ctx.conversationId,
          role: "assistant",
          content: ctx.message,
          channel: "whatsapp",
          provider: "meta_cloud",
          provider_message_id: result.providerMessageId ?? null,
          delivery_status: "sent",
          metadata: { source: "follow_up", template: !inWindow },
        });
        if (error) {
          console.error("whatsapp: outbound message persist failed:", error.message);
        }
      }

      return {
        ok: true,
        retryable: false,
        detail: inWindow ? "text" : "template",
      };
    },
  };
}

/** Default instance used by the scheduler's channel registry. */
export const whatsAppFollowUpAdapter = createWhatsAppAdapter();
