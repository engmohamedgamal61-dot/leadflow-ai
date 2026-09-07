/**
 * Pure validation for the Integration Hub. No secrets, no I/O.
 * Errors are dictionary codes (`integrationHub.validation.*`), never sentences.
 */

import { parseSubscribedEvents, type IntegrationEventType } from "./events.ts";

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

/**
 * Is this a URL we're willing to have the server POST to?
 *
 * Requires `https://` (an `INTEGRATION_ALLOW_INSECURE_URLS=1` escape hatch
 * permits `http://` for self-hosted / LAN consumers) and blocks obvious
 * SSRF targets: loopback, link-local, the cloud metadata IP, `.local`, and
 * private IPv4 ranges. This is a best-effort filter — DNS rebinding is not
 * fully solvable here — layered on top of the endpoint being owner/admin-only.
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

  const host = parsed.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return { ok: false, code: "integrationHub.validation.urlBlockedHost" };
  }

  // IPv4 literal → block loopback / private / link-local / metadata.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const isPrivate =
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a >= 224;
    if (isPrivate && !allowInsecure) {
      return { ok: false, code: "integrationHub.validation.urlBlockedHost" };
    }
  }

  // IPv6 loopback / unique-local / link-local.
  if (host.includes(":")) {
    const bare = host.replace(/^\[|\]$/g, "");
    if (
      bare === "::1" ||
      bare.startsWith("fc") ||
      bare.startsWith("fd") ||
      bare.startsWith("fe80")
    ) {
      if (!allowInsecure) {
        return { ok: false, code: "integrationHub.validation.urlBlockedHost" };
      }
    }
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
