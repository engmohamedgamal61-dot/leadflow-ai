"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/types";
import { requireOrganizationContext } from "@/lib/org/context";
import { canManageConfig } from "@/lib/org/roles";
import { encryptToken, tokenEncryptionKey } from "@/lib/whatsapp/crypto";
import { checkMetaPhoneNumber } from "@/lib/whatsapp/meta-client";
import {
  validateConnectionInput,
  validateFollowUpTemplate,
} from "@/lib/whatsapp/validation";

export interface WhatsAppFormState {
  ok?: boolean;
  message?: string;
  error?: string;
  details?: string[];
}

/** owner/admin only — a connection holds credentials (same set as org config). */
async function requireConnectionAdmin() {
  const { membership } = await requireOrganizationContext();
  if (!canManageConfig(membership.role)) {
    return { ok: false as const, error: "Only an owner or admin can manage integrations." };
  }
  return { ok: true as const, membership };
}

export async function connectWhatsAppAction(
  _prev: WhatsAppFormState,
  formData: FormData,
): Promise<WhatsAppFormState> {
  const guard = await requireConnectionAdmin();
  if (!guard.ok) return { error: guard.error };

  const v = validateConnectionInput({
    phoneNumberId: formData.get("phoneNumberId"),
    accessToken: formData.get("accessToken"),
    wabaId: formData.get("wabaId"),
    displayPhoneNumber: formData.get("displayPhoneNumber"),
  });
  if (!v.ok) return { error: "Please fix the connection details.", details: v.errors };

  let encrypted: string;
  try {
    encrypted = encryptToken(v.clean.accessToken, tokenEncryptionKey());
  } catch {
    return { error: "The server is missing WHATSAPP_TOKEN_ENCRYPTION_KEY." };
  }

  // Live check (mocked when WHATSAPP_MOCK_TRANSPORT=1).
  const check = await checkMetaPhoneNumber({
    phoneNumberId: v.clean.phoneNumberId,
    accessToken: v.clean.accessToken,
    apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION,
  });

  const supabase = await createClient();
  const row: TablesInsert<"whatsapp_connections"> = {
    organization_id: guard.membership.organizationId,
    provider: "meta_cloud",
    phone_number_id: v.clean.phoneNumberId,
    waba_id: v.clean.wabaId || null,
    display_phone_number:
      check.displayPhoneNumber ?? (v.clean.displayPhoneNumber || null),
    access_token_encrypted: encrypted,
    status: check.ok ? "connected" : "error",
    last_error: check.ok ? null : (check.errorDetail ?? "connection check failed"),
  };

  const { error } = await supabase
    .from("whatsapp_connections")
    .upsert(row, { onConflict: "organization_id" })
    .select("id");

  if (error) {
    // A duplicate phone_number_id already claimed by another organization.
    if (error.code === "23505") {
      return { error: "That phone number ID is already connected to another workspace." };
    }
    return { error: "You don't have permission to change this." };
  }

  revalidatePath("/dashboard/settings/integrations");
  return check.ok
    ? { ok: true, message: "WhatsApp connected." }
    : { error: `Saved, but the connection check failed: ${check.errorDetail ?? "unknown error"}` };
}

export async function testWhatsAppConnectionAction(): Promise<WhatsAppFormState> {
  const guard = await requireConnectionAdmin();
  if (!guard.ok) return { error: guard.error };

  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_connections")
    .select("phone_number_id, access_token_encrypted")
    .eq("organization_id", guard.membership.organizationId)
    .maybeSingle();

  if (!data?.access_token_encrypted) {
    return { error: "No WhatsApp connection to test." };
  }

  let token: string;
  try {
    const { decryptToken } = await import("@/lib/whatsapp/crypto");
    token = decryptToken(data.access_token_encrypted, tokenEncryptionKey());
  } catch {
    return { error: "Could not read the stored credentials." };
  }

  const check = await checkMetaPhoneNumber({
    phoneNumberId: data.phone_number_id,
    accessToken: token,
    apiVersion: process.env.WHATSAPP_GRAPH_API_VERSION,
  });

  await supabase
    .from("whatsapp_connections")
    .update(
      check.ok
        ? { status: "connected", last_error: null, display_phone_number: check.displayPhoneNumber ?? undefined }
        : { status: "error", last_error: check.errorDetail ?? "connection check failed" },
    )
    .eq("organization_id", guard.membership.organizationId);

  revalidatePath("/dashboard/settings/integrations");
  return check.ok
    ? { ok: true, message: `Connection OK${check.verifiedName ? ` — ${check.verifiedName}` : ""}.` }
    : { error: `Connection check failed: ${check.errorDetail ?? "unknown error"}` };
}

export async function disconnectWhatsAppAction(): Promise<WhatsAppFormState> {
  const guard = await requireConnectionAdmin();
  if (!guard.ok) return { error: guard.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_connections")
    .update({ status: "disconnected", access_token_encrypted: null, last_error: null })
    .eq("organization_id", guard.membership.organizationId)
    .select("id");
  if (error) return { error: "You don't have permission to change this." };

  revalidatePath("/dashboard/settings/integrations");
  return { ok: true, message: "WhatsApp disconnected." };
}

export async function updateFollowUpTemplateAction(
  _prev: WhatsAppFormState,
  formData: FormData,
): Promise<WhatsAppFormState> {
  const guard = await requireConnectionAdmin();
  if (!guard.ok) return { error: guard.error };

  const v = validateFollowUpTemplate({
    name: formData.get("templateName"),
    language: formData.get("templateLanguage"),
  });
  if (!v.ok) return { error: v.error };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("whatsapp_connections")
    .select("metadata")
    .eq("organization_id", guard.membership.organizationId)
    .maybeSingle();
  if (!current) return { error: "Connect WhatsApp first." };

  const metadata = { ...((current.metadata ?? {}) as Record<string, unknown>) };
  if (v.clean) metadata.followUpTemplate = v.clean;
  else delete metadata.followUpTemplate;

  const { error } = await supabase
    .from("whatsapp_connections")
    .update({ metadata: metadata as TablesInsert<"whatsapp_connections">["metadata"] })
    .eq("organization_id", guard.membership.organizationId)
    .select("id");
  if (error) return { error: "You don't have permission to change this." };

  revalidatePath("/dashboard/settings/integrations");
  return { ok: true, message: v.clean ? "Follow-up template saved." : "Follow-up template cleared." };
}
