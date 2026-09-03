import Anthropic from "@anthropic-ai/sdk";

/**
 * Model used for the qualification chat. Override with the `ANTHROPIC_MODEL`
 * env var — for a high-volume chat widget a smaller model such as
 * `claude-haiku-4-5` or `claude-sonnet-5` is usually the better cost/latency
 * trade-off.
 */
export const CHAT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

/** Assistant replies are short; keep the ceiling modest. */
export const MAX_TOKENS = 1024;

let client: Anthropic | null = null;

/**
 * Lazily construct the Anthropic client so a missing key surfaces as a handled
 * request error rather than a crash at module load.
 */
export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}
