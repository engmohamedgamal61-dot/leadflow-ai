/**
 * Normalise a Meta WhatsApp Cloud API webhook payload into a generic model.
 * Pure and fully defensive — a malformed payload yields empty arrays, never a
 * throw. Phase H supports inbound `text` only; other types are normalised with
 * `supported: false` so the caller can handle them gracefully.
 *
 * Shape (per Meta docs):
 *   { object, entry: [{ changes: [{ value: {
 *       metadata: { phone_number_id, display_phone_number },
 *       contacts: [{ profile: { name }, wa_id }],
 *       messages: [{ from, id, timestamp, type, text: { body } }],
 *       statuses: [{ id, status, timestamp, recipient_id, errors }] }, field }] }] }
 */

export interface NormalizedInboundMessage {
  /** Meta `wamid...` — the idempotency identity. */
  providerMessageId: string;
  /** Sender wa_id (phone, digits only). */
  from: string;
  contactName: string | null;
  timestamp: string;
  type: string;
  /** Message body when `type === "text"`, else `null`. */
  text: string | null;
  supported: boolean;
}

export interface NormalizedStatusUpdate {
  /** The outbound message's `wamid`. */
  providerMessageId: string;
  status: string; // sent | delivered | read | failed | ...
  timestamp: string;
  recipientId: string;
  errorDetail: string | null;
}

export interface ParsedWebhook {
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  messages: NormalizedInboundMessage[];
  statuses: NormalizedStatusUpdate[];
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseWhatsAppWebhook(body: unknown): ParsedWebhook {
  const out: ParsedWebhook = {
    phoneNumberId: null,
    displayPhoneNumber: null,
    messages: [],
    statuses: [],
  };

  const root = obj(body);
  for (const entry of arr(root.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      const metadata = obj(value.metadata);
      out.phoneNumberId ??= str(metadata.phone_number_id);
      out.displayPhoneNumber ??= str(metadata.display_phone_number);

      const contacts = arr(value.contacts);
      const nameByWaId = new Map<string, string>();
      for (const c of contacts) {
        const co = obj(c);
        const waId = str(co.wa_id);
        const name = str(obj(co.profile).name);
        if (waId && name) nameByWaId.set(waId, name);
      }

      for (const m of arr(value.messages)) {
        const mo = obj(m);
        const id = str(mo.id);
        const from = str(mo.from);
        if (!id || !from) continue;
        const type = str(mo.type) ?? "unknown";
        const text = type === "text" ? str(obj(mo.text).body) : null;
        out.messages.push({
          providerMessageId: id,
          from,
          contactName: nameByWaId.get(from) ?? null,
          timestamp: str(mo.timestamp) ?? "",
          type,
          text,
          supported: type === "text" && text !== null,
        });
      }

      for (const s of arr(value.statuses)) {
        const so = obj(s);
        const id = str(so.id);
        if (!id) continue;
        const errors = arr(so.errors);
        const firstErr = errors.length > 0 ? obj(errors[0]) : {};
        out.statuses.push({
          providerMessageId: id,
          status: str(so.status) ?? "unknown",
          timestamp: str(so.timestamp) ?? "",
          recipientId: str(so.recipient_id) ?? "",
          errorDetail:
            str(firstErr.title) ??
            str(firstErr.message) ??
            str(obj(firstErr.error_data).details) ??
            null,
        });
      }
    }
  }

  return out;
}
