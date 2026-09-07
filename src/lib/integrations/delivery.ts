/**
 * Delivery phase of the Integration Hub worker: sign and POST one claimed
 * delivery, classify the response, and record the outcome on both the delivery
 * row and the endpoint's health counters.
 *
 * Never throws — the worker treats a thrown error as a retryable failure, but
 * this function resolves an outcome itself for every expected case.
 *
 *   2xx                     → succeeded
 *   408 / 429 / 5xx / network/timeout → retry (until max_attempts, then dead)
 *   other 4xx               → dead immediately (consumer misconfigured)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/types";
import {
  AUTO_DISABLE_AFTER_FAILURES,
  MAX_RESPONSE_SNIPPET,
  nextAttemptAt,
  resolveHttpTimeoutMs,
} from "./config.ts";
import {
  buildSignatureHeaders,
  DELIVERY_HEADER,
  EVENT_HEADER,
} from "./signature.ts";
import { redactSecrets } from "../observability/report.ts";

type Db = SupabaseClient<Database>;
type DeliveryRow = Tables<"integration_deliveries">;
type EndpointRow = Tables<"integration_endpoints">;

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  text: () => Promise<string>;
}>;

export interface DeliverOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: Date;
}

export type DeliveryDisposition = "succeeded" | "retry_scheduled" | "dead";

function classify(status: number): "ok" | "retry" | "dead" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "dead";
}

export async function deliverOne(
  db: Db,
  input: { delivery: DeliveryRow; endpoint: EndpointRow; secret: string },
  opts: DeliverOptions = {},
): Promise<DeliveryDisposition> {
  const { delivery, endpoint, secret } = input;
  const now = opts.now ?? new Date();
  const timeoutMs =
    opts.timeoutMs ?? resolveHttpTimeoutMs(process.env.INTEGRATION_HUB_HTTP_TIMEOUT_MS);
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  const body =
    typeof delivery.payload === "string"
      ? delivery.payload
      : JSON.stringify(delivery.payload);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "LeadFlow-Webhooks/1",
    [EVENT_HEADER]: delivery.event_type,
    [DELIVERY_HEADER]: delivery.id,
    ...buildSignatureHeaders(secret, body, now),
  };

  const startedAt = Date.now();
  let statusCode: number | null = null;
  let outcome: "ok" | "retry" | "dead";
  let errorText: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(endpoint.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      statusCode = res.status;
      outcome = classify(res.status);
      if (outcome !== "ok") {
        const snippet = await res.text().catch(() => "");
        errorText = `HTTP ${res.status}${snippet ? `: ${snippet.slice(0, MAX_RESPONSE_SNIPPET)}` : ""}`;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    outcome = "retry";
    errorText =
      err instanceof Error
        ? err.name === "AbortError" || err.name === "TimeoutError"
          ? `request timed out after ${timeoutMs}ms`
          : err.message.slice(0, MAX_RESPONSE_SNIPPET)
        : "network error";
  }

  const durationMs = Date.now() - startedAt;
  const safeError = errorText ? redactSecrets(errorText).slice(0, 500) : null;

  // ── success ────────────────────────────────────────────────────────────
  if (outcome === "ok") {
    await db
      .from("integration_deliveries")
      .update({
        status: "succeeded",
        delivered_at: now.toISOString(),
        last_status_code: statusCode,
        last_duration_ms: durationMs,
        last_error: null,
        claimed_at: null,
      })
      .eq("id", delivery.id);
    await db
      .from("integration_endpoints")
      .update({
        consecutive_failures: 0,
        last_success_at: now.toISOString(),
        last_error: null,
      })
      .eq("id", endpoint.id);
    return "succeeded";
  }

  const exhausted = delivery.attempt_count >= delivery.max_attempts;
  const terminal = outcome === "dead" || exhausted;

  await db
    .from("integration_deliveries")
    .update({
      status: terminal ? "dead" : "failed",
      last_status_code: statusCode,
      last_duration_ms: durationMs,
      last_error: safeError,
      next_attempt_at: terminal
        ? delivery.next_attempt_at
        : nextAttemptAt(delivery.attempt_count, now),
      claimed_at: null,
    })
    .eq("id", delivery.id);

  // ── endpoint health ───────────────────────────────────────────────────
  const nextFailures = endpoint.consecutive_failures + 1;
  const autoDisable =
    endpoint.enabled && nextFailures >= AUTO_DISABLE_AFTER_FAILURES;
  await db
    .from("integration_endpoints")
    .update({
      consecutive_failures: nextFailures,
      last_failure_at: now.toISOString(),
      last_error: safeError,
      ...(autoDisable
        ? { enabled: false, disabled_reason: "auto_disabled_failures" }
        : {}),
    })
    .eq("id", endpoint.id);

  return terminal ? "dead" : "retry_scheduled";
}
