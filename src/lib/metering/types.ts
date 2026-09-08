/**
 * Shared metering vocabulary. Pure — no I/O.
 *
 * `request_type` is stored as free text in `ai_usage_events` (a future type
 * needs no migration), but the types LeadFlow emits today are enumerated so
 * the aggregation and UI can treat them as canonical. An unrecognised value
 * from an older row groups under `"other"` in the dashboard.
 */

import type { TokenUsage } from "./pricing.ts";

export const AI_REQUEST_TYPES = [
  "chat_reply",
  "lead_extraction",
  "sales_manager",
] as const;
export type AiRequestType = (typeof AI_REQUEST_TYPES)[number];

/** Narrow an arbitrary stored string to a known request type, or `null`. */
export function asAiRequestType(value: string): AiRequestType | null {
  return (AI_REQUEST_TYPES as readonly string[]).includes(value)
    ? (value as AiRequestType)
    : null;
}

export interface RecordUsageInput {
  organizationId: string;
  requestType: AiRequestType;
  /** The Anthropic model string actually used for the call. */
  model: string;
  /** Origin channel: "web" | "whatsapp" | … */
  channel?: string | null;
  usage: TokenUsage;
  conversationId?: string | null;
  leadId?: string | null;
  /** Per-turn idempotency key (same value a retried chat turn carries). */
  requestId?: string | null;
  /** Override the recorded timestamp (tests / backfill). Defaults to now. */
  occurredAt?: Date;
}

/**
 * Normalise an Anthropic `usage` object (from `message.usage`, the streaming
 * `finalMessage()`, or a non-streaming response) to plain token counts. Missing
 * / null fields become 0. Kept structural so it also accepts the mock-transport
 * shape and is unit-testable without the SDK.
 */
export function normalizeAnthropicUsage(
  usage:
    | {
        input_tokens?: number | null;
        output_tokens?: number | null;
        cache_read_input_tokens?: number | null;
        cache_creation_input_tokens?: number | null;
      }
    | null
    | undefined,
): TokenUsage {
  const nn = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  return {
    inputTokens: nn(usage?.input_tokens),
    outputTokens: nn(usage?.output_tokens),
    cacheReadInputTokens: nn(usage?.cache_read_input_tokens),
    cacheCreationInputTokens: nn(usage?.cache_creation_input_tokens),
  };
}

/** Total billable tokens for a usage object. */
export function totalTokens(usage: TokenUsage): number {
  return (
    (usage.inputTokens || 0) +
    (usage.outputTokens || 0) +
    (usage.cacheReadInputTokens || 0) +
    (usage.cacheCreationInputTokens || 0)
  );
}
