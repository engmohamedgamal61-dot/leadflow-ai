/**
 * Lightweight structured operational logging — the informational counterpart
 * to `reportError` (report.ts). One JSON line per call, always to stdout
 * (Vercel/most hosts collect stdout as structured logs already — no vendor
 * SDK, no extra infrastructure). Same redaction rule as `reportError`: never
 * a secret, a message body, or lead PII — only ids, counts, statuses, and
 * durations.
 *
 * Used for the "at minimum" observability surface (see
 * docs/PRODUCTION-HARDENING.md): a `requestId` correlator through
 * `/api/chat`, the WhatsApp webhook and the integration worker, plus
 * `durationMs` for Anthropic calls, Google Calendar calls, and major
 * DB/persistence operations.
 */

import { redactSecrets } from "./report.ts";

export interface LogFields {
  /** Short dotted event name, e.g. "anthropic.chat_reply", "calendar.google.freeBusy". */
  event: string;
  /** Log-correlation id for one request/turn/run. Never the source of truth for DB idempotency. */
  requestId?: string | null;
  organizationId?: string | null;
  durationMs?: number;
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Emit one structured info line. Never throws — a logging failure must never
 * affect the caller. Not for errors: use `reportError` for those (it also
 * alerts via `OPS_ALERT_WEBHOOK_URL`); this is unconditional stdout only.
 */
export function logEvent(fields: LogFields): void {
  try {
    const { event, ...rest } = fields;
    const safe: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      safe[k] = typeof v === "string" ? redactSecrets(v) : v;
    }
    console.log(
      JSON.stringify({ level: "info", event, ...safe, at: new Date().toISOString() }),
    );
  } catch {
    // Logging must never throw into the caller's request path.
  }
}
