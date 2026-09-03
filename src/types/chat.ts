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
 * Structured lead data extracted from the conversation so far.
 *
 * Every field is `null` until the prospect has actually provided it — values
 * are never invented. Shapes are canonical so a downstream store (Supabase,
 * a later phase) can consume this object directly:
 * - `intent`        — `"buy"` | `"rent"`
 * - `location`      — city / district, in English (e.g. "Riyadh")
 * - `budget`        — integer amount in SAR (e.g. 1000000)
 * - `property_type` — lowercase English (e.g. "apartment", "villa")
 * - `bedrooms`      — integer
 * - `financing`     — `true` if the prospect needs financing, `false` if cash
 * - `timeline`      — short English phrase (e.g. "1 week", "3 months", "ASAP")
 */
export interface LeadData {
  name: string | null;
  intent: "buy" | "rent" | null;
  location: string | null;
  budget: number | null;
  property_type: string | null;
  bedrooms: number | null;
  financing: boolean | null;
  timeline: string | null;
}

export const LEAD_FIELD_KEYS = [
  "name",
  "intent",
  "location",
  "budget",
  "property_type",
  "bedrooms",
  "financing",
  "timeline",
] as const;

export const EMPTY_LEAD: LeadData = {
  name: null,
  intent: null,
  location: null,
  budget: null,
  property_type: null,
  bedrooms: null,
  financing: null,
  timeline: null,
};

/**
 * Byte that separates the streamed reply text from the trailing lead JSON in
 * the `/api/chat` response body. ASCII "record separator" — never present in
 * natural language output.
 */
export const LEAD_DELIMITER = String.fromCharCode(0x1e);

export interface SendOptions {
  /** Abort an in-flight request. */
  signal?: AbortSignal;
  /** Called with each streamed text chunk as it arrives. */
  onToken?: (chunk: string) => void;
  /** Called once with the structured lead data after the reply completes. */
  onLead?: (lead: LeadData) => void;
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
