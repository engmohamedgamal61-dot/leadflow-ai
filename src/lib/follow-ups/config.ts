/**
 * Scheduler tuning — pure, server-configurable, no I/O. All values come from
 * server-only env vars (never `NEXT_PUBLIC_*`).
 */

export const DEFAULT_BATCH_SIZE = 25;
export const MAX_BATCH_SIZE = 200;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_STUCK_PROCESSING_MS = 15 * 60_000;

function intFrom(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Bounded batch size: `[1, MAX_BATCH_SIZE]`, default 25. */
export function resolveBatchSize(raw?: unknown): number {
  const n = intFrom(raw);
  if (n === null || n < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(n, MAX_BATCH_SIZE);
}

/** Max delivery attempts before a follow-up becomes `failed`. `[1, 10]`. */
export function resolveMaxAttempts(raw?: unknown): number {
  const n = intFrom(raw);
  if (n === null || n < 1) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(n, 10);
}

export function resolveStuckAfterMs(raw?: unknown): number {
  const n = intFrom(raw);
  if (n === null || n < 60_000) return DEFAULT_STUCK_PROCESSING_MS;
  return Math.min(n, 3_600_000);
}

/**
 * Deterministic retry backoff by (post-increment) attempt count:
 *   attempt 1 → 2 min, attempt 2 → 10 min, attempt 3+ → 30 min.
 */
export function retryDelayMs(attemptCount: number): number {
  if (attemptCount <= 1) return 2 * 60_000;
  if (attemptCount === 2) return 10 * 60_000;
  return 30 * 60_000;
}

export function nextAttemptAt(attemptCount: number, now: Date = new Date()): string {
  return new Date(now.getTime() + retryDelayMs(attemptCount)).toISOString();
}
