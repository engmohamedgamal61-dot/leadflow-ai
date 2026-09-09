/**
 * Pure validation for the Integration Hub. No secrets, no I/O.
 * Errors are dictionary codes (`integrationHub.validation.*`), never sentences.
 */

import { parseSubscribedEvents, type IntegrationEventType } from "./events.ts";
import { isBlockedIp, isBlockedIpv4, parseIpv4 } from "../security/ip-guard.ts";

export interface EndpointInput {
  name: string;
  url: string;
  events: IntegrationEventType[];
  description: string;
}

export interface EndpointValidation {
  ok: boolean;
  errors: string[];
  clean: EndpointInput;
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const BLOCKED = { ok: false as const, code: "integrationHub.validation.urlBlockedHost" };

/**
 * Is this a URL we're willing to have the server POST to?
 *
 * Requires `https://` (an `INTEGRATION_ALLOW_INSECURE_URLS=1` escape hatch
 * permits `http://` for self-hosted / LAN consumers) and blocks SSRF targets:
 * loopback, link-local, cloud metadata, private ranges, and single-label /
 * `.local` / `.internal` hostnames — across every IP-literal encoding
 * (integer, hex, octal, short-form, IPv4-mapped IPv6). URL credentials are
 * rejected too. This is best-effort: DNS rebinding is not solvable here, so
 * the delivery worker re-checks and refuses to follow redirects.
 */
export function isSafeWebhookUrl(
  raw: string,
  opts: { allowInsecure?: boolean } = {},
): { ok: true; url: string } | { ok: false; code: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, code: "integrationHub.validation.urlInvalid" };
  }

  const allowInsecure =
    opts.allowInsecure ?? process.env.INTEGRATION_ALLOW_INSECURE_URLS === "1";

  if (parsed.protocol !== "https:" && !(allowInsecure && parsed.protocol === "http:")) {
    return { ok: false, code: "integrationHub.validation.urlNotHttps" };
  }

  // Embedded credentials (`https://user:pass@host/…`) — never legitimate here
  // and a classic filter-bypass vector.
  if (parsed.username || parsed.password) return BLOCKED;

  const host = parsed.hostname.toLowerCase();
  const bracketless = host.replace(/^\[|\]$/g, "");

  // Any IPv6 literal → judge on the address (covers ::1, ULA, link-local,
  // IPv4-mapped like [::ffff:169.254.169.254], documentation ranges, …).
  if (bracketless.includes(":")) {
    if (isBlockedIp(bracketless) && !allowInsecure) return BLOCKED;
    return { ok: true, url: parsed.toString() };
  }

  const v4 = parseIpv4(host);
  if (v4) {
    if (isBlockedIpv4(v4) && !allowInsecure) return BLOCKED;
    return { ok: true, url: parsed.toString() };
  }

  if (
    host === "localhost" ||
    host === "" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    // A single-label host (no dot, not an IP) resolves via search domains to
    // something internal far more often than to a real public consumer.
    !host.includes(".")
  ) {
    if (!allowInsecure) return BLOCKED;
  }

  return { ok: true, url: parsed.toString() };
}

export function validateEndpointInput(
  raw: {
    name?: unknown;
    url?: unknown;
    events?: unknown;
    description?: unknown;
  },
  opts: { allowInsecure?: boolean } = {},
): EndpointValidation {
  const name = s(raw.name);
  const rawUrl = s(raw.url);
  const description = s(raw.description);
  const events = parseSubscribedEvents(
    typeof raw.events === "string"
      ? raw.events.split(",").map((e) => e.trim())
      : raw.events,
  );
  const errors: string[] = [];

  if (name.length < 1 || name.length > 80) {
    errors.push("integrationHub.validation.nameLength");
  }

  let cleanUrl = rawUrl;
  if (!rawUrl) {
    errors.push("integrationHub.validation.urlRequired");
  } else {
    const safe = isSafeWebhookUrl(rawUrl, opts);
    if (!safe.ok) errors.push(safe.code);
    else cleanUrl = safe.url;
  }

  if (events.length === 0) {
    errors.push("integrationHub.validation.eventsRequired");
  }

  if (description.length > 300) {
    errors.push("integrationHub.validation.descriptionLength");
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    clean: { name, url: cleanUrl, events, description },
  };
}
