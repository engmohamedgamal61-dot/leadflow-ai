/**
 * HMAC signing + verification for the Integration Hub — pure, no I/O, no env.
 *
 * Scheme (same family as Stripe / GitHub webhooks):
 *   signed value = `<timestamp>.<raw body>`
 *   header       = `X-LeadFlow-Signature: sha256=<hex HMAC-SHA256(secret, signed value)>`
 *   plus         `X-LeadFlow-Timestamp: <unix seconds>`
 *
 * The timestamp is INSIDE the signed value, so a replay with a stale timestamp
 * fails both the freshness check and the signature check. Comparisons are
 * constant-time. Nothing here logs the secret or the signature.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-leadflow-signature";
export const TIMESTAMP_HEADER = "x-leadflow-timestamp";
export const EVENT_HEADER = "x-leadflow-event";
export const DELIVERY_HEADER = "x-leadflow-delivery";

/** Default replay window: a request's timestamp must be within ±5 minutes. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

function hexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Raw hex HMAC-SHA256 over `<timestamp>.<body>`. */
export function computeSignature(
  secret: string,
  timestamp: number | string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
}

/** The two headers to attach to an outbound delivery. */
export function buildSignatureHeaders(
  secret: string,
  body: string,
  now: Date = new Date(),
): Record<string, string> {
  const ts = Math.floor(now.getTime() / 1000);
  return {
    [TIMESTAMP_HEADER]: String(ts),
    [SIGNATURE_HEADER]: `sha256=${computeSignature(secret, ts, body)}`,
  };
}

export interface VerifyResult {
  ok: boolean;
  /** Machine reason when `ok` is false — for logs/audit, never shown raw. */
  reason?:
    | "missing_signature"
    | "missing_timestamp"
    | "malformed_signature"
    | "malformed_timestamp"
    | "timestamp_out_of_tolerance"
    | "bad_signature";
}

/**
 * Verify an inbound request against an endpoint's secret.
 * `signatureHeader` may be `sha256=<hex>` or a bare `<hex>`.
 */
export function verifySignature(input: {
  secret: string;
  body: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  now?: Date;
  toleranceSeconds?: number;
}): VerifyResult {
  const { secret, body } = input;
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = input.now ?? new Date();

  if (typeof input.signatureHeader !== "string" || input.signatureHeader === "") {
    return { ok: false, reason: "missing_signature" };
  }
  if (typeof input.timestampHeader !== "string" || input.timestampHeader === "") {
    return { ok: false, reason: "missing_timestamp" };
  }

  const sigMatch = input.signatureHeader.trim().match(/^(?:sha256=)?([0-9a-f]{64})$/i);
  if (!sigMatch) return { ok: false, reason: "malformed_signature" };

  const ts = Number(input.timestampHeader.trim());
  if (!Number.isFinite(ts) || !Number.isInteger(ts) || ts <= 0) {
    return { ok: false, reason: "malformed_timestamp" };
  }

  const skew = Math.abs(Math.floor(now.getTime() / 1000) - ts);
  if (skew > tolerance) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const expected = computeSignature(secret, ts, body);
  if (!hexEqual(sigMatch[1].toLowerCase(), expected.toLowerCase())) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}
