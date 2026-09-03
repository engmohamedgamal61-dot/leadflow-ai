import Anthropic from "@anthropic-ai/sdk";

/**
 * Model used for the qualification chat.
 *
 * Default: `claude-sonnet-5` — strong multilingual understanding (needed for
 * Arabic / English / Arabizi) at a real-time-chat price point ($2 / $10 per
 * MTok). Override with the `ANTHROPIC_MODEL` env var; `claude-haiku-4-5` is
 * cheaper still, `claude-opus-5` is higher quality but slower and pricier.
 */
export const CHAT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

/**
 * Assistant replies are one acknowledgement plus one question — short. Arabic
 * uses more tokens per character, so leave some headroom.
 */
export const MAX_TOKENS = 1024;

let client: Anthropic | null = null;

/**
 * Lazily construct the Anthropic client so a missing key surfaces as a handled
 * request error rather than a crash at module load. The key is read from the
 * server-only `ANTHROPIC_API_KEY` env var and never leaves the server.
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  client ??= new Anthropic({ apiKey });
  return client;
}
