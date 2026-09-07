/**
 * Fan-out phase of the Integration Hub worker: drain the transactional outbox
 * into per-endpoint `integration_deliveries` rows.
 *
 * For each un-fanned outbox row: find the org's enabled endpoints subscribed to
 * that event, build the signed envelope body once, and insert one delivery per
 * endpoint. The `(endpoint_id, outbox_event_id)` unique index makes this
 * idempotent — a re-run after a crash never double-creates.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/supabase/types";
import { isIntegrationEventType } from "./events.ts";
import { buildEventData } from "./snapshot.ts";
import { buildDeliveryEnvelope, serializeEnvelope } from "./payload.ts";
import { resolveMaxAttempts } from "./config.ts";

type Db = SupabaseClient<Database>;

export interface FanoutOptions {
  limit?: number;
  maxAttempts?: number;
}

export interface FanoutSummary {
  outboxProcessed: number;
  deliveriesCreated: number;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export async function fanOutOutbox(
  db: Db,
  opts: FanoutOptions = {},
): Promise<FanoutSummary> {
  const limit = opts.limit ?? 100;
  const maxAttempts =
    opts.maxAttempts ?? resolveMaxAttempts(process.env.INTEGRATION_HUB_MAX_ATTEMPTS);

  const { data: rows, error } = await db
    .from("integration_event_outbox")
    .select("id, organization_id, event_type, lead_id, payload, occurred_at")
    .is("fanned_out_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const summary: FanoutSummary = { outboxProcessed: 0, deliveriesCreated: 0 };

  for (const row of rows ?? []) {
    summary.outboxProcessed += 1;

    if (!isIntegrationEventType(row.event_type)) {
      await markFannedOut(db, row.id);
      continue;
    }

    const { data: endpoints } = await db
      .from("integration_endpoints")
      .select("id")
      .eq("organization_id", row.organization_id)
      .eq("enabled", true)
      .contains("subscribed_events", [row.event_type]);

    if (!endpoints || endpoints.length === 0) {
      await markFannedOut(db, row.id);
      continue;
    }

    const data = await buildEventData(db, {
      organizationId: row.organization_id,
      eventType: row.event_type,
      leadId: row.lead_id,
      payload: asRecord(row.payload),
    });

    const envelope = buildDeliveryEnvelope({
      eventId: row.id,
      type: row.event_type,
      occurredAt: row.occurred_at,
      organizationId: row.organization_id,
      data,
    });
    const body = serializeEnvelope(envelope);

    const inserts: TablesInsert<"integration_deliveries">[] = endpoints.map(
      (e) => ({
        organization_id: row.organization_id,
        endpoint_id: e.id,
        outbox_event_id: row.id,
        event_type: row.event_type,
        payload: JSON.parse(body) as TablesInsert<"integration_deliveries">["payload"],
        status: "pending",
        max_attempts: maxAttempts,
        kind: "event",
      }),
    );

    const { data: created, error: insErr } = await db
      .from("integration_deliveries")
      .upsert(inserts, {
        onConflict: "endpoint_id,outbox_event_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (insErr) throw insErr;
    summary.deliveriesCreated += created?.length ?? 0;

    await markFannedOut(db, row.id);
  }

  return summary;
}

async function markFannedOut(db: Db, id: string): Promise<void> {
  await db
    .from("integration_event_outbox")
    .update({ fanned_out_at: new Date().toISOString() })
    .eq("id", id);
}
