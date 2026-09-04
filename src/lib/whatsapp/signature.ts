/**
 * Meta webhook authenticity — pure. Two checks:
 *  - GET verification handshake (`hub.mode` / `hub.verify_token` / `hub.challenge`)
 *  - POST payload signature (`X-Hub-Signature-256: sha256=<HMAC-SHA256(raw body, app secret)>`)
 *
 * Secrets come from server-only env and are compared in constant time. Neither
 * this module nor its callers log the secret or the signature.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * GET webhook verification. Returns the challenge string to echo back with a
 * 200 when the token matches, or `null` (caller responds 403).
 */
export function verifyWebhookChallenge(
  params: {
    mode: string | null;
    token: string | null;
    challenge: string | null;
  },
  expectedToken: string | undefined | null,
): string | null {
  if (typeof expectedToken !== "string" || expectedToken.length < 8) return null;
  if (params.mode !== "subscribe") return null;
  if (typeof params.token !== "string" || typeof params.challenge !== "string") {
    return null;
  }
  return safeEqual(params.token, expectedToken) ? params.challenge : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still burn a compare against a fixed-size buffer to avoid length leak.
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Validate the `X-Hub-Signature-256` header against the RAW request body.
 * `rawBody` MUST be the exact bytes Meta sent (not re-serialised JSON).
 */
export function verifySignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string | undefined | null,
): boolean {
  if (typeof appSecret !== "string" || appSecret.length < 8) return false;
  if (typeof signatureHeader !== "string") return false;
  const m = signatureHeader.match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;

  const expected = createHmac("sha256", appSecret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("hex");

  return safeEqual(m[1].toLowerCase(), expected.toLowerCase());
}
