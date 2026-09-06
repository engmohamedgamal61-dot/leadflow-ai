/**
 * Operational error reporting — provider-agnostic and env-gated.
 *
 * `reportError` always writes a structured, secret-redacted line to the server
 * log, and — when `OPS_ALERT_WEBHOOK_URL` is set — POSTs a compact
 * `{ text }` payload to it (Slack / Discord / Mattermost incoming webhooks and
 * most generic alerting endpoints accept that shape). It never throws, never
 * blocks the caller for long, and never includes a secret or `process.env`.
 *
 * There is no vendor SDK: swapping providers is a URL change.
 */

const REDACTION = "[redacted]";

// Values that look like credentials: a keyword (`key`, `token`, `Bearer`,
// `"secret"`, …) followed by `:`, `=` or whitespace and a long-ish token.
const SECRET_ASSIGNMENT_RE =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|authorization|auth[_-]?token|bearer|token|apikey)["'\s]*[:=\s]\s*["']?)([A-Za-z0-9._\-+/=]{8,})/gi;
// Bare high-entropy tokens that commonly appear in provider payloads/URLs.
const BARE_TOKEN_RE = /\b(sk-[A-Za-z0-9-]{16,}|eyJ[A-Za-z0-9._-]{20,}|EAA[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,})\b/g;

/** Strip anything that looks like a secret from a string. Pure. */
export function redactSecrets(input: string): string {
  return input
    .replace(SECRET_ASSIGNMENT_RE, (_m, prefix: string) => `${prefix}${REDACTION}`)
    .replace(BARE_TOKEN_RE, REDACTION);
}

export interface ErrorContext {
  /** Where it happened, e.g. "chat.route", "whatsapp.webhook", "scheduler". */
  scope: string;
  /** Extra safe, non-PII breadcrumbs (ids, counts, statuses). */
  [key: string]: string | number | boolean | null | undefined;
}

interface StructuredReport {
  level: "error";
  scope: string;
  message: string;
  stack: string | null;
  context: Record<string, string | number | boolean | null>;
  at: string;
}

function toStructured(error: unknown, context: ErrorContext): StructuredReport {
  const { scope, ...rest } = context;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
  const stack =
    error instanceof Error && typeof error.stack === "string"
      ? error.stack.split("\n").slice(0, 6).join("\n")
      : null;

  const safeContext: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    safeContext[k] = typeof v === "string" ? redactSecrets(v) : v;
  }

  return {
    level: "error",
    scope,
    message: redactSecrets(message),
    stack: stack ? redactSecrets(stack) : null,
    context: safeContext,
    at: new Date().toISOString(),
  };
}

async function postWebhook(url: string, report: StructuredReport): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const ctx = Object.entries(report.context)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: LeadFlow [${report.scope}] ${report.message}${ctx ? ` · ${ctx}` : ""}`,
      }),
      signal: controller.signal,
    });
  } catch {
    // An alerting channel being down must never affect the request.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Report a server-side error. Fire-and-forget: callers should NOT await this
 * on a hot path (`void reportError(...)`). Safe to await in an `after()` block.
 */
export async function reportError(error: unknown, context: ErrorContext): Promise<void> {
  const report = toStructured(error, context);
  console.error(`[ops] ${JSON.stringify(report)}`);

  const url = process.env.OPS_ALERT_WEBHOOK_URL;
  if (url && /^https:\/\//.test(url)) {
    await postWebhook(url, report);
  }
}
