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

const BLOCKED = { ok: false as const, code: "integrationHub.validation.urlBlockedHost" };

/**
 * Parse the many ways an IPv4 address can be written (dotted quad, a bare
 * 32-bit integer, hex `0x7f000001`, octal `0177.0.0.1`, and short forms like
 * `127.1`) into a canonical `[a,b,c,d]`, or `null` if it isn't an IPv4 literal.
 * `new URL()` keeps these forms verbatim in `hostname`, so the naive
 * dotted-quad regex the old filter used was trivially bypassed.
 */
function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length === 0 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const p of parts) {
    if (p === "") return null;
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^\d+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  // Fold the "short forms": a.b.c.d, a.b.(c<<8|d), a.(b<<16|...), a(=32-bit).
  let value: number;
  if (nums.length === 1) value = nums[0];
  else if (nums.length === 2) value = (nums[0] << 24) | (nums[1] & 0xff_ffff);
  else if (nums.length === 3)
    value = (nums[0] << 24) | (nums[1] << 16) | (nums[2] & 0xffff);
  else value = (nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3];

  value = value >>> 0;
  if (nums.length === 4 && nums.some((n) => n > 255)) return null;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** True for loopback / private / link-local / metadata / reserved IPv4. */
function isBlockedIpv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24, 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

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

  let host = parsed.hostname.toLowerCase();
  // `new URL` wraps IPv6 in brackets; strip an IPv4-mapped IPv6 down to its v4.
  const bracketless = host.replace(/^\[|\]$/g, "");
  const mapped = bracketless.match(/^(?:::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) host = mapped[1];
  else if (bracketless.includes(":")) {
    // Any other IPv6 literal: block the well-known bad ranges outright.
    if (
      bracketless === "::1" ||
      bracketless === "::" ||
      bracketless.startsWith("fc") ||
      bracketless.startsWith("fd") ||
      bracketless.startsWith("fe80") ||
      bracketless.startsWith("::ffff:") ||
      bracketless.startsWith("2001:db8")
    ) {
      if (!allowInsecure) return BLOCKED;
    }
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
    (!host.includes(".") && !host.includes(":") && parseIpv4(host) === null)
  ) {
    if (!allowInsecure) return BLOCKED;
  }

  const v4 = parseIpv4(host);
  if (v4 && isBlockedIpv4(v4) && !allowInsecure) return BLOCKED;

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
