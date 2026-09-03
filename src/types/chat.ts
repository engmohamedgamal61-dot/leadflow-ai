export type MessageRole = "assistant" | "user";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

/** The minimal message shape exchanged with the chat API. */
export interface ChatTurn {
  role: MessageRole;
  content: string;
}

/**
 * Generic, industry-agnostic lead.
 *
 * The **core** is a small set of fields that mean the same thing in every
 * industry ({@link CORE_LEAD_FIELD_KEYS}). Everything an industry defines
 * beyond that — a real-estate `budget`, a clinic `appointment_date` — lives
 * in `customData`, keyed by the field's `LeadFieldDefinition.key`.
 *
 * A value is `null` (or absent from `customData`) until the prospect has
 * actually provided it — values are never invented.
 *
 * Example (real estate):
 * ```json
 * { "name": "محمد", "phone": null, "email": null, "intent": "buy",
 *   "customData": { "location": "Riyadh", "budget": 1000000,
 *     "property_type": "apartment", "bedrooms": 4, "financing": true,
 *     "timeline": "1 week" } }
 * ```
 */
export interface LeadData {
  name: string | null;
  phone: string | null;
  email: string | null;
  /** What the prospect wants (e.g. "buy" / "rent"); industry-defined vocab. */
  intent: string | null;
  /** Industry-specific fields, keyed by `LeadFieldDefinition.key`. */
  customData: Record<string, unknown>;
}

/** Field keys that map to top-level {@link LeadData} properties. */
export const CORE_LEAD_FIELD_KEYS = [
  "name",
  "phone",
  "email",
  "intent",
] as const;

export type CoreLeadFieldKey = (typeof CORE_LEAD_FIELD_KEYS)[number];

export const EMPTY_LEAD: LeadData = {
  name: null,
  phone: null,
  email: null,
  intent: null,
  customData: {},
};

export function isCoreLeadField(key: string): key is CoreLeadFieldKey {
  return (CORE_LEAD_FIELD_KEYS as readonly string[]).includes(key);
}

/**
 * Read a field's value from a lead whether it is a core field or lives in
 * `customData`. Returns `null` for anything missing or malformed — never
 * throws. This is how the scoring engine resolves `rule.fieldKey` without
 * caring which industry (or where on the object) the value lives.
 */
export function getLeadFieldValue(lead: LeadData, fieldKey: string): unknown {
  if (!lead || typeof lead !== "object") return null;
  if (isCoreLeadField(fieldKey)) {
    return lead[fieldKey] ?? null;
  }
  const custom = lead.customData;
  if (!custom || typeof custom !== "object") return null;
  const value = (custom as Record<string, unknown>)[fieldKey];
  return value ?? null;
}

/**
 * Byte that separates the streamed reply text from the trailing lead JSON in
 * the `/api/chat` response body. ASCII "record separator" (U+001E) — never
 * present in natural language output.
 */
export const LEAD_DELIMITER = String.fromCharCode(0x1e);

export interface SendOptions {
  /** Abort an in-flight request. */
  signal?: AbortSignal;
  /** Called with each streamed text chunk as it arrives. */
  onToken?: (chunk: string) => void;
  /**
   * Called once when the visible assistant reply has finished streaming, just
   * before the trailing lead JSON is read. Lets the UI re-enable input right
   * away instead of waiting for the post-reply lead extraction + persistence.
   */
  onReplyEnd?: () => void;
  /** Called once with the structured lead data after the reply completes. */
  onLead?: (lead: LeadData) => void;
  /**
   * Called once with the persisted conversation id (or `null` if persistence
   * is disabled). Pass it back as `conversationId` on the next turn.
   */
  onConversation?: (conversationId: string | null) => void;
  /**
   * Industry template slug for this conversation (e.g. "real-estate",
   * "clinic"). Omit to use the server default.
   */
  industry?: string;
  /** Persisted conversation id from a previous turn, to continue the chat. */
  conversationId?: string;
  /**
   * Per-turn idempotency key. A retried / replayed identical request carries
   * the same value so the server persists the turn exactly once.
   */
  requestId?: string;
}

/**
 * Contract for anything that can produce assistant replies.
 *
 * `apiAssistant` (lib/chat/api-assistant.ts) talks to the `/api/chat` route,
 * which calls Claude. `mockAssistant` (lib/chat/mock-assistant.ts) is a
 * dependency-free stand-in for local development and tests. The UI depends
 * only on this interface.
 */
export interface AssistantClient {
  send(messages: ChatMessage[], options?: SendOptions): Promise<string>;
}
