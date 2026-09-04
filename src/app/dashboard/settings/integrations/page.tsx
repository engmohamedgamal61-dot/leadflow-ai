import type { Metadata } from "next";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/leads/format";
import { WhatsAppSettings } from "./whatsapp-form";

export const metadata: Metadata = { title: "Integrations — LeadFlow AI" };

export interface WhatsAppConnectionView {
  status: string;
  phoneNumberId: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  lastError: string | null;
  followUpTemplate: { name: string; language: string } | null;
  updatedAt: string;
}

export default async function IntegrationsPage() {
  const { membership } = await requireOrganizationContext();
  const canManage = canManageConfig(membership.role);

  const supabase = await createClient();
  // Never selects `access_token_encrypted` — and the column is revoked from
  // `authenticated` at the database level anyway.
  const { data } = await supabase
    .from("whatsapp_connections")
    .select(
      "status, phone_number_id, waba_id, display_phone_number, last_error, metadata, updated_at",
    )
    .eq("organization_id", membership.organizationId)
    .maybeSingle();

  const tpl = (data?.metadata as { followUpTemplate?: { name?: string; language?: string } } | null)
    ?.followUpTemplate;

  const connection: WhatsAppConnectionView | null = data
    ? {
        status: data.status,
        phoneNumberId: data.phone_number_id,
        wabaId: data.waba_id,
        displayPhoneNumber: data.display_phone_number,
        lastError: data.last_error,
        followUpTemplate:
          tpl && tpl.name
            ? { name: tpl.name, language: tpl.language ?? "en_US" }
            : null,
        updatedAt: data.updated_at,
      }
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Integrations</h1>
        <p className="mt-1 text-sm text-muted">
          Connect external channels. LeadFlow uses the same AI engine across
          every channel.
        </p>
        {!canManage ? (
          <p className="mt-2 inline-block rounded-md border border-border bg-background px-2 py-1 text-xs text-muted">
            Read-only — an owner or admin can manage integrations.
          </p>
        ) : null}
      </div>

      <WhatsAppSettings
        connection={connection}
        canManage={canManage}
        lastUpdated={connection ? formatDateTime(connection.updatedAt) : null}
      />
    </div>
  );
}
