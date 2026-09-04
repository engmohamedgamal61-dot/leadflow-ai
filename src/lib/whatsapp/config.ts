/**
 * WhatsApp integration config — server-only env, isolated so the Graph API
 * version and endpoint are never hardcoded across the integration.
 */

/** Meta deprecates Graph API versions ~yearly; override per deployment. */
export const DEFAULT_GRAPH_API_VERSION = "v23.0";

export function graphApiVersion(raw?: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  return /^v\d+\.\d+$/.test(v) ? v : DEFAULT_GRAPH_API_VERSION;
}

export function graphMessagesUrl(phoneNumberId: string, version: string): string {
  return `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`;
}

/** Meta's customer-service (free-form) window. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinSessionWindow(
  lastInboundAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < SESSION_WINDOW_MS;
}
