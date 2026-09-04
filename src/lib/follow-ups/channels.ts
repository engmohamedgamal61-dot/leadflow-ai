/**
 * Generic follow-up delivery channel.
 *
 *   Scheduler → Executor → ChannelAdapter
 *
 * Phase G ships only the `internal` adapter (no external send). A later phase
 * registers `whatsapp` / `email` / `sms` adapters here and the scheduler +
 * executor stay unchanged.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export interface FollowUpDeliveryContext {
  /**
   * The (already-trusted) Supabase client from the executor. An adapter that
   * talks to an external API needs it to resolve credentials + the recipient,
   * scoped by `organizationId`. The `internal` adapter ignores it.
   */
  db: SupabaseClient<Database>;
  organizationId: string;
  leadId: string;
  conversationId: string | null;
  channel: string;
  /** The rendered message body (see `message.ts`). */
  message: string;
  /** Demo organizations must never trigger a real external send. */
  isDemo: boolean;
}

export interface FollowUpDeliveryResult {
  ok: boolean;
  /** When `ok` is false: may the scheduler retry this later? */
  retryable: boolean;
  /** Short, non-sensitive detail for `last_error` / logs. */
  detail?: string;
}

export interface FollowUpChannelAdapter {
  readonly name: string;
  deliver(ctx: FollowUpDeliveryContext): Promise<FollowUpDeliveryResult>;
}

/**
 * The development / demo adapter. Proves the execution lifecycle without
 * sending anything: it "delivers" by recording that it ran. Never fails.
 */
export const internalAdapter: FollowUpChannelAdapter = {
  name: "internal",
  async deliver(ctx) {
    // No PII / message body in logs.
    console.log(
      `[follow-up:internal] delivered org=${ctx.organizationId} lead=${ctx.leadId} demo=${ctx.isDemo} len=${ctx.message.length}`,
    );
    return { ok: true, retryable: false };
  },
};

export const CHANNEL_ADAPTERS: Record<string, FollowUpChannelAdapter> = {
  internal: internalAdapter,
};

/**
 * Resolve the adapter for a channel. An unknown / not-yet-implemented channel
 * (whatsapp, email, …) falls back to `internal` so Phase G never performs an
 * external action.
 */
export function resolveAdapter(
  channel: string,
  adapters: Record<string, FollowUpChannelAdapter> = CHANNEL_ADAPTERS,
): FollowUpChannelAdapter {
  const adapter = adapters[channel];
  if (adapter) return adapter;
  if (channel !== "internal") {
    console.warn(
      `[follow-up] no adapter for channel "${channel}" — using internal (no external send)`,
    );
  }
  return adapters.internal ?? internalAdapter;
}
