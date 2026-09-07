/**
 * The Integration Hub worker engine — decoupled from HTTP. A thin route
 * (`/api/internal/integrations/run`) is the only trigger; a platform cron just
 * calls that route.
 *
 * One run: (1) fan the transactional outbox out into per-endpoint delivery
 * rows, then (2) claim a bounded batch of due deliveries atomically (via
 * `claim_integration_deliveries`, `FOR UPDATE SKIP LOCKED`) and send each.
 * Returns a counts-only summary — no endpoint URL, no payload, no lead PII.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/types";
import { createAdminClient } from "../supabase/admin.ts";
import { reportError } from "../observability/report.ts";
import {
  resolveDeliveryBatchSize,
  resolveStuckAfterMs,
} from "./config.ts";
import { fanOutOutbox } from "./fanout.ts";
import { deliverOne, type DeliverOptions, type FetchLike } from "./delivery.ts";
import { decryptEndpointSecret } from "./secret.ts";

type Db = SupabaseClient<Database>;

export interface IntegrationRunSummary {
  runId: string;
  outboxProcessed: number;
  deliveriesCreated: number;
  claimed: number;
  succeeded: number;
  retryScheduled: number;
  dead: number;
  skipped: number;
  durationMs: number;
}

export interface RunIntegrationHubOptions {
  batchSize?: number;
  stuckAfterMs?: number;
  now?: Date;
  db?: Db;
  fetchImpl?: FetchLike;
  /** Skip the fan-out phase (test seam). */
  skipFanout?: boolean;
}

const EMPTY = (runId: string, durationMs: number): IntegrationRunSummary => ({
  runId,
  outboxProcessed: 0,
  deliveriesCreated: 0,
  claimed: 0,
  succeeded: 0,
  retryScheduled: 0,
  dead: 0,
  skipped: 0,
  durationMs,
});

export async function runIntegrationHub(
  opts: RunIntegrationHubOptions = {},
): Promise<IntegrationRunSummary> {
  const runId =
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`
    ).slice(0, 8);
  const started = Date.now();

  let db: Db;
  try {
    db = opts.db ?? (createAdminClient() as Db);
  } catch {
    return EMPTY(runId, Date.now() - started);
  }

  const summary = EMPTY(runId, 0);

  // ── phase 1: fan-out ──────────────────────────────────────────────────
  if (!opts.skipFanout) {
    try {
      const f = await fanOutOutbox(db);
      summary.outboxProcessed = f.outboxProcessed;
      summary.deliveriesCreated = f.deliveriesCreated;
    } catch (err) {
      void reportError(err, { scope: "integrations.worker", phase: "fanout", runId });
    }
  }

  // ── phase 2: deliver ─────────────────────────────────────────────────
  const batchSize =
    opts.batchSize ?? resolveDeliveryBatchSize(process.env.INTEGRATION_HUB_BATCH_SIZE);
  const stuckAfterMs =
    opts.stuckAfterMs ??
    resolveStuckAfterMs(process.env.INTEGRATION_HUB_STUCK_DELIVERING_MS);

  const { data: claimed, error } = await db.rpc("claim_integration_deliveries", {
    p_limit: batchSize,
    p_stuck_after: `${Math.round(stuckAfterMs / 1000)} seconds`,
  });
  if (error) {
    void reportError(error, { scope: "integrations.worker", phase: "claim", runId });
    summary.durationMs = Date.now() - started;
    return summary;
  }

  const rows = (claimed ?? []) as Tables<"integration_deliveries">[];
  summary.claimed = rows.length;

  // Load the endpoints referenced by this batch once.
  const endpointIds = [...new Set(rows.map((r) => r.endpoint_id))];
  const endpointById = new Map<string, Tables<"integration_endpoints">>();
  if (endpointIds.length > 0) {
    const { data: endpoints } = await db
      .from("integration_endpoints")
      .select("*")
      .in("id", endpointIds);
    for (const e of endpoints ?? []) endpointById.set(e.id, e);
  }

  const deliverOpts: DeliverOptions = { now: opts.now, fetchImpl: opts.fetchImpl };

  for (const delivery of rows) {
    const endpoint = endpointById.get(delivery.endpoint_id);
    if (!endpoint) {
      await failClaim(db, delivery.id, "endpoint no longer exists");
      summary.dead += 1;
      continue;
    }
    // A test delivery still sends even if the endpoint is disabled (it's an
    // explicit user action); an event delivery to a disabled endpoint is
    // parked back to pending so it resumes if the endpoint is re-enabled.
    if (!endpoint.enabled && delivery.kind === "event") {
      await db
        .from("integration_deliveries")
        .update({ status: "pending", claimed_at: null, attempt_count: Math.max(0, delivery.attempt_count - 1) })
        .eq("id", delivery.id);
      summary.skipped += 1;
      continue;
    }

    let secret: string;
    try {
      secret = decryptEndpointSecret(endpoint.secret_encrypted);
    } catch {
      await failClaim(db, delivery.id, "cannot read endpoint secret");
      summary.dead += 1;
      continue;
    }

    try {
      const disposition = await deliverOne(
        db,
        { delivery, endpoint, secret },
        deliverOpts,
      );
      if (disposition === "succeeded") summary.succeeded += 1;
      else if (disposition === "retry_scheduled") summary.retryScheduled += 1;
      else summary.dead += 1;
    } catch (err) {
      void reportError(err, {
        scope: "integrations.worker",
        phase: "deliver",
        runId,
        deliveryId: delivery.id,
      });
      // Return it to the queue; the next run retries.
      await db
        .from("integration_deliveries")
        .update({ status: "failed", claimed_at: null })
        .eq("id", delivery.id);
      summary.retryScheduled += 1;
    }
  }

  summary.durationMs = Date.now() - started;
  console.log(
    `[integration-hub] run=${runId} outbox=${summary.outboxProcessed} created=${summary.deliveriesCreated} claimed=${summary.claimed} ok=${summary.succeeded} retry=${summary.retryScheduled} dead=${summary.dead} skipped=${summary.skipped} duration=${summary.durationMs}ms`,
  );
  return summary;
}

async function failClaim(db: Db, id: string, reason: string): Promise<void> {
  await db
    .from("integration_deliveries")
    .update({ status: "dead", last_error: reason, claimed_at: null })
    .eq("id", id);
}
