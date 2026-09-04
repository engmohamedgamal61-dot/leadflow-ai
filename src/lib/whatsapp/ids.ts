/**
 * Deterministic UUID from a provider identifier (e.g. a WhatsApp `wamid`).
 *
 * The chat persistence layer keys idempotency on a `uuid` `request_id`. A
 * retried Meta webhook carries the same `wamid`, so mapping it to a stable
 * UUID means the downstream `persistChatTurn` / agent-action idempotency
 * collapses the retry too — a second layer of protection behind the
 * `whatsapp_inbound_events` primary key.
 *
 * RFC 4122 v5 (namespace + SHA-1). Pure — `node:crypto` only.
 */

import { createHash } from "node:crypto";

// A fixed namespace UUID for LeadFlow WhatsApp provider ids.
const NAMESPACE = "6f9a1e10-6b2b-4c3d-9e7a-1f2b3c4d5e6f";

function namespaceBytes(): Buffer {
  return Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
}

export function uuidFromProviderId(providerId: string): string {
  const hash = createHash("sha1")
    .update(namespaceBytes())
    .update(Buffer.from(providerId, "utf8"))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
