/**
 * Dashboard read layer for the Integration Hub. Every read runs on the
 * caller's RLS-scoped session client (`db`) and is additionally scoped by the
 * membership-derived `organization_id`. The signing secret column is revoked
 * from `authenticated` at the DB level, so it can never appear here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  IntegrationDeliveryStatus,
} from "@/lib/supabase/types";
import type { IntegrationEventType } from "./events";

type Db = SupabaseClient<Database>;

export interface EndpointView {
  id: string;
  name: string;
  url: string;
  secretHint: string;
  secretRotatedAt: string | null;
  enabled: boolean;
  disabledReason: string | null;
  subscribedEvents: IntegrationEventType[];
  description: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  /** Derived: ok | failing | never | disabled. */
  health: "ok" | "failing" | "never" | "disabled";
}

export interface DeliveryView {
  id: string;
  endpointId: string;
  eventType: string;
  status: IntegrationDeliveryStatus;
  kind: "event" | "test";
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastStatusCode: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  lastDurationMs: number | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface InboundActionView {
  id: string;
  endpointId: string;
  action: string;
  status: string;
  leadId: string | null;
  errorCode: string | null;
  receivedAt: string;
}

function healthOf(row: {
  enabled: boolean;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
}): EndpointView["health"] {
  if (!row.enabled) return "disabled";
  if (row.consecutive_failures > 0) return "failing";
  if (!row.last_success_at && !row.last_failure_at) return "never";
  return "ok";
}

const ENDPOINT_COLS =
  "id, name, url, secret_hint, secret_rotated_at, enabled, disabled_reason, subscribed_events, description, consecutive_failures, last_success_at, last_failure_at, last_error, created_at, updated_at";

function toEndpointView(row: {
  id: string;
  name: string;
  url: string;
  secret_hint: string;
  secret_rotated_at: string | null;
  enabled: boolean;
  disabled_reason: string | null;
  subscribed_events: string[];
  description: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}): EndpointView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    secretHint: row.secret_hint,
    secretRotatedAt: row.secret_rotated_at,
    enabled: row.enabled,
    disabledReason: row.disabled_reason,
    subscribedEvents: (row.subscribed_events ?? []) as IntegrationEventType[],
    description: row.description,
    consecutiveFailures: row.consecutive_failures,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    health: healthOf(row),
  };
}

export async function listEndpoints(
  db: Db,
  organizationId: string,
): Promise<EndpointView[]> {
  const { data, error } = await db
    .from("integration_endpoints")
    .select(ENDPOINT_COLS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toEndpointView);
}

export async function getEndpoint(
  db: Db,
  organizationId: string,
  endpointId: string,
): Promise<EndpointView | null> {
  const { data, error } = await db
    .from("integration_endpoints")
    .select(ENDPOINT_COLS)
    .eq("organization_id", organizationId)
    .eq("id", endpointId)
    .maybeSingle();
  if (error) throw error;
  return data ? toEndpointView(data) : null;
}

export async function listDeliveries(
  db: Db,
  organizationId: string,
  endpointId: string,
  limit = 25,
): Promise<DeliveryView[]> {
  const { data, error } = await db
    .from("integration_deliveries")
    .select(
      "id, endpoint_id, event_type, status, kind, attempt_count, max_attempts, next_attempt_at, last_status_code, last_error, last_attempt_at, last_duration_ms, delivered_at, created_at",
    )
    .eq("organization_id", organizationId)
    .eq("endpoint_id", endpointId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    endpointId: r.endpoint_id,
    eventType: r.event_type,
    status: r.status,
    kind: r.kind,
    attemptCount: r.attempt_count,
    maxAttempts: r.max_attempts,
    nextAttemptAt: r.next_attempt_at,
    lastStatusCode: r.last_status_code,
    lastError: r.last_error,
    lastAttemptAt: r.last_attempt_at,
    lastDurationMs: r.last_duration_ms,
    deliveredAt: r.delivered_at,
    createdAt: r.created_at,
  }));
}

export interface EndpointDeliveryStats {
  succeeded: number;
  pending: number;
  failed: number;
  dead: number;
}

/** Small counts summary for one endpoint's recent deliveries (bounded scan). */
export async function getEndpointDeliveryStats(
  db: Db,
  organizationId: string,
  endpointId: string,
): Promise<EndpointDeliveryStats> {
  const { data, error } = await db
    .from("integration_deliveries")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("endpoint_id", endpointId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const stats: EndpointDeliveryStats = { succeeded: 0, pending: 0, failed: 0, dead: 0 };
  for (const r of data ?? []) {
    if (r.status === "succeeded") stats.succeeded += 1;
    else if (r.status === "dead") stats.dead += 1;
    else if (r.status === "failed") stats.failed += 1;
    else stats.pending += 1;
  }
  return stats;
}

export async function listInboundActions(
  db: Db,
  organizationId: string,
  endpointId: string,
  limit = 25,
): Promise<InboundActionView[]> {
  const { data, error } = await db
    .from("integration_inbound_actions")
    .select("id, endpoint_id, action, status, lead_id, error_code, received_at")
    .eq("organization_id", organizationId)
    .eq("endpoint_id", endpointId)
    .order("received_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    endpointId: r.endpoint_id,
    action: r.action,
    status: r.status,
    leadId: r.lead_id,
    errorCode: r.error_code,
    receivedAt: r.received_at,
  }));
}
