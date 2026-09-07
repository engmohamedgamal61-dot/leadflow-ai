"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables, TablesInsert } from "@/lib/supabase/types";
import { requireOrganizationContext } from "@/lib/org/context";
import { canManageConfig } from "@/lib/org/roles";
import { validateEndpointInput } from "./validation";
import {
  encryptEndpointSecret,
  generateEndpointSecret,
  secretHint,
} from "./secret";
import { deliverOne } from "./delivery";

const HUB_PATH = "/dashboard/settings/integrations";

export interface EndpointFormState {
  ok?: boolean;
  /** Dotted dictionary key for a success message. */
  messageCode?: string;
  /** Dotted dictionary key for an error. */
  errorCode?: string;
  params?: Record<string, string | number>;
  /** Raw validator codes (`integrationHub.validation.*`). */
  details?: string[];
  /** The plaintext signing secret — returned ONCE on create / rotate. */
  secret?: string;
  /** New endpoint id (on create). */
  endpointId?: string;
}

async function requireHubAdmin() {
  const { membership, user } = await requireOrganizationContext();
  if (!canManageConfig(membership.role)) {
    return { ok: false as const, errorCode: "integrationHub.errors.onlyOwnerAdmin" };
  }
  return { ok: true as const, membership, user };
}

function revalidate(endpointId?: string) {
  revalidatePath(HUB_PATH);
  if (endpointId) revalidatePath(`${HUB_PATH}/webhooks/${endpointId}`);
}

function fields(formData: FormData) {
  return {
    name: formData.get("name"),
    url: formData.get("url"),
    events: formData.getAll("events"),
    description: formData.get("description"),
  };
}

export async function createEndpointAction(
  _prev: EndpointFormState,
  formData: FormData,
): Promise<EndpointFormState> {
  const guard = await requireHubAdmin();
  if (!guard.ok) return { errorCode: guard.errorCode };

  const v = validateEndpointInput(fields(formData));
  if (!v.ok) return { errorCode: "integrationHub.errors.fixDetails", details: v.errors };

  const secret = generateEndpointSecret();
  let encrypted: string;
  try {
    encrypted = encryptEndpointSecret(secret);
  } catch {
    return { errorCode: "integrationHub.errors.missingKey" };
  }

  const supabase = await createClient();
  const row: TablesInsert<"integration_endpoints"> = {
    organization_id: guard.membership.organizationId,
    name: v.clean.name,
    url: v.clean.url,
    secret_encrypted: encrypted,
    secret_hint: secretHint(secret),
    subscribed_events: v.clean.events,
    description: v.clean.description || null,
    created_by: guard.user.id,
  };
  const { data, error } = await supabase
    .from("integration_endpoints")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) {
    return { errorCode: "integrationHub.errors.noPermission" };
  }

  revalidate(data.id);
  return {
    ok: true,
    messageCode: "integrationHub.results.created",
    secret,
    endpointId: data.id,
  };
}

export async function updateEndpointAction(
  _prev: EndpointFormState,
  formData: FormData,
): Promise<EndpointFormState> {
  const guard = await requireHubAdmin();
  if (!guard.ok) return { errorCode: guard.errorCode };

  const endpointId = String(formData.get("endpointId") ?? "");
  if (!endpointId) return { errorCode: "integrationHub.errors.notFound" };

  const v = validateEndpointInput(fields(formData));
  if (!v.ok) return { errorCode: "integrationHub.errors.fixDetails", details: v.errors };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_endpoints")
    .update({
      name: v.clean.name,
      url: v.clean.url,
      subscribed_events: v.clean.events,
      description: v.clean.description || null,
    })
    .eq("organization_id", guard.membership.organizationId)
    .eq("id", endpointId)
    .select("id");
  if (error || !data || data.length === 0) {
    return { errorCode: "integrationHub.errors.noPermission" };
  }

  revalidate(endpointId);
  return { ok: true, messageCode: "integrationHub.results.updated" };
}

export async function setEndpointEnabledAction(
  endpointId: string,
  enabled: boolean,
): Promise<EndpointFormState> {
  const guard = await requireHubAdmin();
  if (!guard.ok) return { errorCode: guard.errorCode };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_endpoints")
    .update(
      enabled
        ? { enabled: true, disabled_reason: null, consecutive_failures: 0 }
        : { enabled: false, disabled_reason: "manual" },
    )
    .eq("organization_id", guard.membership.organizationId)
    .eq("id", endpointId)
    .select("id");
  if (error || !data || data.length === 0) {
    return { errorCode: "integrationHub.errors.noPermission" };
  }

  revalidate(endpointId);
  return {
    ok: true,
    messageCode: enabled
      ? "integrationHub.results.enabled"
      : "integrationHub.results.disabled",
  };
}

export async function deleteEndpointAction(
  endpointId: string,
): Promise<EndpointFormState> {
  const guard = await requireHubAdmin();
  if (!guard.ok) return { errorCode: guard.errorCode };

  const supabase = await createClient();
  const { error } = await supabase
    .from("integration_endpoints")
    .delete()
    .eq("organization_id", guard.membership.organizationId)
    .eq("id", endpointId);
  if (error) return { errorCode: "integrationHub.errors.noPermission" };

  revalidate();
  return { ok: true, messageCode: "integrationHub.results.deleted" };
}

export async function rotateSecretAction(
  endpointId: string,
): Promise<EndpointFormState> {
  const guard = await requireHubAdmin();
  if (!guard.ok) return { errorCode: guard.errorCode };

  const secret = generateEndpointSecret();
  let encrypted: string;
  try {
    encrypted = encryptEndpointSecret(secret);
  } catch {
    return { errorCode: "integrationHub.errors.missingKey" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("integration_endpoints")
    .update({
      secret_encrypted: encrypted,
      secret_hint: secretHint(secret),
      secret_rotated_at: new Date().toISOString(),
    })
    .eq("organization_id", guard.membership.organizationId)
    .eq("id", endpointId)
    .select("id");
  if (error || !data || data.length === 0) {
    return { errorCode: "integrationHub.errors.noPermission" };
  }

  revalidate(endpointId);
  return { ok: true, messageCode: "integrationHub.results.rotated", secret };
}

/**
 * Send a signed test delivery synchronously so the user gets an immediate
 * pass/fail. Writes to `integration_deliveries` (service-role — that table's
 * writes are worker-only), gated by the app-level owner/admin check above.
 */
export async function sendTestWebhookAction(
  endpointId: string,
): Promise<EndpointFormState> {
  const guard = await requireHubAdmin();
  if (!guard.ok) return { errorCode: guard.errorCode };

  const admin = createAdminClient();
  const { data: endpoint } = await admin
    .from("integration_endpoints")
    .select("*")
    .eq("organization_id", guard.membership.organizationId)
    .eq("id", endpointId)
    .maybeSingle();
  if (!endpoint) return { errorCode: "integrationHub.errors.notFound" };

  let secret: string;
  try {
    const { decryptEndpointSecret } = await import("./secret");
    secret = decryptEndpointSecret(endpoint.secret_encrypted);
  } catch {
    return { errorCode: "integrationHub.errors.cantReadSecret" };
  }

  const now = new Date();
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    type: "ping",
    occurred_at: now.toISOString(),
    organization_id: guard.membership.organizationId,
    data: { message: "LeadFlow Integration Hub test delivery" },
  });

  const { data: delivery, error: insErr } = await admin
    .from("integration_deliveries")
    .insert({
      organization_id: guard.membership.organizationId,
      endpoint_id: endpoint.id,
      event_type: "ping",
      payload: JSON.parse(body) as TablesInsert<"integration_deliveries">["payload"],
      status: "delivering",
      attempt_count: 1,
      max_attempts: 1,
      claimed_at: now.toISOString(),
      kind: "test",
    })
    .select("*")
    .single();
  if (insErr || !delivery) {
    return { errorCode: "integrationHub.errors.testFailed" };
  }

  const disposition = await deliverOne(
    admin,
    {
      delivery: delivery as Tables<"integration_deliveries">,
      endpoint: endpoint as Tables<"integration_endpoints">,
      secret,
    },
    { now },
  );

  revalidate(endpointId);
  return disposition === "succeeded"
    ? { ok: true, messageCode: "integrationHub.results.testOk" }
    : { errorCode: "integrationHub.results.testFailed" };
}

export async function retryDeliveryAction(
  deliveryId: string,
): Promise<EndpointFormState> {
  const guard = await requireHubAdmin();
  if (!guard.ok) return { errorCode: guard.errorCode };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integration_deliveries")
    .update({
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      claimed_at: null,
    })
    .eq("organization_id", guard.membership.organizationId)
    .eq("id", deliveryId)
    .in("status", ["failed", "dead"])
    .select("endpoint_id");
  if (error || !data || data.length === 0) {
    return { errorCode: "integrationHub.errors.retryFailed" };
  }

  revalidate(data[0].endpoint_id);
  return { ok: true, messageCode: "integrationHub.results.retryQueued" };
}
