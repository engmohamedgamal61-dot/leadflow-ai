/**
 * WhatsApp connection resolution — the trusted-server layer between Meta
 * identifiers and LeadFlow organizations. Two clients are used deliberately:
 *  - the RLS session client for dashboard reads/writes (never selects the token),
 *  - the service-role client for the webhook + outbound adapter (needs the token).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { decryptToken, tokenEncryptionKey } from "./crypto.ts";

type Db = SupabaseClient<Database>;

export interface ResolvedWhatsAppOrg {
  organizationId: string;
  industryTemplateId: string;
  connectionId: string;
  status: string;
  orgHasMembers: boolean;
}

/**
 * Resolve the organization for an inbound webhook from Meta's
 * `phone_number_id` — the ONLY trusted key. Returns `null` for an unknown or
 * not-`connected` connection (the webhook then logs a safe diagnostic and
 * does nothing). Never trusts anything client/webhook-supplied beyond the
 * phone number id.
 */
export async function resolveOrgByPhoneNumberId(
  db: Db,
  phoneNumberId: string,
): Promise<ResolvedWhatsAppOrg | null> {
  if (!phoneNumberId) return null;
  const { data, error } = await db
    .from("whatsapp_connections")
    .select(
      "id, organization_id, status, organizations ( industry_template_id )",
    )
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== "connected") return null;

  const org = data.organizations as { industry_template_id: string } | null;
  if (!org) return null;

  const members = await db
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("organization_id", data.organization_id);

  return {
    organizationId: data.organization_id,
    industryTemplateId: org.industry_template_id,
    connectionId: data.id,
    status: data.status,
    orgHasMembers: (members.count ?? 0) > 0,
  };
}

export interface WhatsAppSendCredentials {
  phoneNumberId: string;
  accessToken: string;
  followUpTemplate: { name: string; language: string } | null;
}

/**
 * Load an organization's connection WITH the decrypted access token — only for
 * the trusted server boundary (webhook reply, outbound follow-up adapter).
 * `null` when there is no connected connection or the token can't be decrypted.
 */
export async function getSendCredentials(
  db: Db,
  organizationId: string,
): Promise<WhatsAppSendCredentials | null> {
  const { data, error } = await db
    .from("whatsapp_connections")
    .select("phone_number_id, status, access_token_encrypted, metadata")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== "connected" || !data.access_token_encrypted) return null;

  let accessToken: string;
  try {
    accessToken = decryptToken(data.access_token_encrypted, tokenEncryptionKey());
  } catch (e) {
    console.error(
      `whatsapp: token decrypt failed for org ${organizationId}:`,
      e instanceof Error ? e.message : "error",
    );
    return null;
  }

  const meta = (data.metadata ?? {}) as {
    followUpTemplate?: { name?: unknown; language?: unknown };
  };
  const tpl = meta.followUpTemplate;
  const followUpTemplate =
    tpl && typeof tpl.name === "string" && tpl.name
      ? {
          name: tpl.name,
          language: typeof tpl.language === "string" ? tpl.language : "en_US",
        }
      : null;

  return {
    phoneNumberId: data.phone_number_id,
    accessToken,
    followUpTemplate,
  };
}

/** Recipient WhatsApp number for a lead/conversation, from persisted data. */
export async function resolveRecipientWaId(
  db: Db,
  organizationId: string,
  conversationId: string | null,
  leadId: string | null,
): Promise<string | null> {
  if (conversationId) {
    const { data } = await db
      .from("conversations")
      .select("external_contact_id, last_inbound_at")
      .eq("organization_id", organizationId)
      .eq("id", conversationId)
      .maybeSingle();
    if (data?.external_contact_id) return data.external_contact_id;
  }
  if (leadId) {
    const { data } = await db
      .from("leads")
      .select("phone")
      .eq("organization_id", organizationId)
      .eq("id", leadId)
      .maybeSingle();
    if (data?.phone) return data.phone.replace(/[^\d]/g, "");
  }
  return null;
}
