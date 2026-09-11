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
 *
 * `maxRetries: 0` at the client level: the SDK's default (2) retries apply to
 * EVERY call made with this client unless overridden per-request, and a blind
 * retry of a partially-streamed chat reply would duplicate output already
 * sent to the caller. Call sites opt back into a small, explicit retry budget
 * for the calls where it's safe (see {@link requestCallOptions}) — see
 * `docs/PRODUCTION-HARDENING.md` for the full policy.
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  client ??= new Anthropic({ apiKey, maxRetries: 0 });
  return client;
}

// ── per-call timeout / retry / cancellation policy ──────────────────────────
//
// Every Anthropic call in the app goes through one of the two helpers below
// instead of hand-rolling `{ timeout, maxRetries, signal }` at each site. Both
// are well under the platform function timeout (300s default on Vercel with
// fluid compute, see docs/PRODUCTION-HARDENING.md) and under the browser's own
// 45s give-up for `/api/chat` (`src/lib/chat/api-assistant.ts`).
//
//   - `streamCallOptions` — the real-time streamed chat reply. `maxRetries: 0`
//     always: a retried stream would re-send content already streamed to the
//     client and double-count usage. Pass the inbound request's `AbortSignal`
//     when one is available so an abandoned client connection stops the
//     Anthropic call too, not just the HTTP response.
//   - `requestCallOptions` — single-shot, non-streaming, idempotent calls
//     (lead/action extraction, the AI Sales Manager's planner + answer calls).
//     A small bounded retry is safe here since nothing has been shown to the
//     caller yet.

/** Default streamed chat-reply timeout, ms — see `resolveStreamTimeoutMs`. */
export const DEFAULT_STREAM_TIMEOUT_MS = 30_000;
/** Default single-shot call timeout, ms — see `resolveRequestTimeoutMs`. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
/** Default single-shot retry budget — see `resolveRequestMaxRetries`. */
export const DEFAULT_REQUEST_MAX_RETRIES = 1;

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** `raw` (an `ANTHROPIC_STREAM_TIMEOUT_MS`-shaped value) → a positive ms timeout. */
export function resolveStreamTimeoutMs(raw: string | undefined): number {
  return positiveIntFromEnv(raw, DEFAULT_STREAM_TIMEOUT_MS);
}

/** `raw` (an `ANTHROPIC_REQUEST_TIMEOUT_MS`-shaped value) → a positive ms timeout. */
export function resolveRequestTimeoutMs(raw: string | undefined): number {
  return positiveIntFromEnv(raw, DEFAULT_REQUEST_TIMEOUT_MS);
}

/**
 * `raw` (an `ANTHROPIC_REQUEST_MAX_RETRIES`-shaped value) → a non-negative
 * retry count for single-shot calls only. Deliberately small by default: a
 * generous retry budget is still bounded per call, but a low default keeps a
 * slow-Anthropic incident from multiplying load.
 */
export function resolveRequestMaxRetries(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_REQUEST_MAX_RETRIES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_REQUEST_MAX_RETRIES;
}

/** Streamed chat-reply timeout — env `ANTHROPIC_STREAM_TIMEOUT_MS`, default 30s. */
export const ANTHROPIC_STREAM_TIMEOUT_MS = resolveStreamTimeoutMs(
  process.env.ANTHROPIC_STREAM_TIMEOUT_MS,
);

/** Single-shot call timeout — env `ANTHROPIC_REQUEST_TIMEOUT_MS`, default 20s. */
export const ANTHROPIC_REQUEST_TIMEOUT_MS = resolveRequestTimeoutMs(
  process.env.ANTHROPIC_REQUEST_TIMEOUT_MS,
);

/**
 * Retries for single-shot calls only — env `ANTHROPIC_REQUEST_MAX_RETRIES`,
 * default 1 (one retry, i.e. at most 2 attempts total).
 */
export const ANTHROPIC_REQUEST_MAX_RETRIES = resolveRequestMaxRetries(
  process.env.ANTHROPIC_REQUEST_MAX_RETRIES,
);

/** Call options for the streamed chat reply. Never retries. */
export function streamCallOptions(signal?: AbortSignal | null): Anthropic.RequestOptions {
  return {
    timeout: ANTHROPIC_STREAM_TIMEOUT_MS,
    maxRetries: 0,
    signal: signal ?? undefined,
  };
}

/** Call options for a single-shot, idempotent structured-output call. */
export function requestCallOptions(signal?: AbortSignal | null): Anthropic.RequestOptions {
  return {
    timeout: ANTHROPIC_REQUEST_TIMEOUT_MS,
    maxRetries: ANTHROPIC_REQUEST_MAX_RETRIES,
    signal: signal ?? undefined,
  };
}
