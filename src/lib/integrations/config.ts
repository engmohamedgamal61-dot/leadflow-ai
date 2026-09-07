/**
 * Integration Hub delivery tuning — pure, server-configurable, no I/O.
 * Values come from server-only env vars (never `NEXT_PUBLIC_*`).
 */

function intFrom(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export const DEFAULT_DELIVERY_BATCH_SIZE = 20;
export const MAX_DELIVERY_BATCH_SIZE = 200;
export const DEFAULT_MAX_ATTEMPTS = 6;
export const DEFAULT_STUCK_DELIVERING_MS = 5 * 60_000;
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
/** Consecutive failed deliveries before an endpoint is auto-disabled. */
export const AUTO_DISABLE_AFTER_FAILURES = 20;
/** Max response body bytes we read back from a consumer (for the error log). */
export const MAX_RESPONSE_SNIPPET = 500;

export function resolveDeliveryBatchSize(raw?: unknown): number {
  const n = intFrom(raw);
  if (n === null || n < 1) return DEFAULT_DELIVERY_BATCH_SIZE;
  return Math.min(n, MAX_DELIVERY_BATCH_SIZE);
}

/** Max delivery attempts before a delivery becomes `dead`. `[1, 12]`. */
export function resolveMaxAttempts(raw?: unknown): number {
  const n = intFrom(raw);
  if (n === null || n < 1) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(n, 12);
}

export function resolveHttpTimeoutMs(raw?: unknown): number {
  const n = intFrom(raw);
  if (n === null || n < 1_000) return DEFAULT_HTTP_TIMEOUT_MS;
  return Math.min(n, 30_000);
}

export function resolveStuckAfterMs(raw?: unknown): number {
  const n = intFrom(raw);
  if (n === null || n < 60_000) return DEFAULT_STUCK_DELIVERING_MS;
  return Math.min(n, 3_600_000);
}

/**
 * Exponential backoff by (post-increment) attempt count:
 *   1 → 30s, 2 → 2m, 3 → 10m, 4 → 1h, 5 → 3h, 6+ → 6h.
 * Deterministic (no jitter) so it is trivially testable and the "next retry"
 * time shown in the UI is exact.
 */
export function retryDelayMs(attemptCount: number): number {
  const table = [30_000, 120_000, 600_000, 3_600_000, 10_800_000, 21_600_000];
  const idx = Math.max(1, Math.trunc(attemptCount)) - 1;
  return table[Math.min(idx, table.length - 1)];
}

export function nextAttemptAt(attemptCount: number, now: Date = new Date()): string {
  return new Date(now.getTime() + retryDelayMs(attemptCount)).toISOString();
}
