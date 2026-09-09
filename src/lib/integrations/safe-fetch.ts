/**
 * SSRF-hardened outbound HTTP for the Integration Hub delivery worker.
 *
 * The hostname is validated as a literal, then RESOLVED and every resolved
 * address is checked against {@link isBlockedIp}. The socket connection is then
 * PINNED to exactly those pre-validated addresses via `http.request`'s `lookup`
 * hook, so a DNS-rebinding answer that flips to `127.0.0.1` between our check
 * and the connect cannot land — the connect uses the address we already
 * approved. Redirects are never followed (a raw request doesn't); the caller
 * treats a 3xx as terminal.
 *
 * `docs/PRODUCTION-SECURITY.md`: a network-egress allowlist is still the
 * strongest final control — this closes the application-layer gap.
 */

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { lookup as dnsLookup } from "node:dns";
import { isBlockedIp } from "../security/ip-guard.ts";
import { isSafeWebhookUrl } from "./validation.ts";

export interface AssertOk {
  ok: true;
  url: URL;
  /** IPv4/IPv6 literals the connection may use. */
  addresses: string[];
}
export interface AssertFail {
  ok: false;
  code: string;
}

type LookupAllFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookupAll: LookupAllFn = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) reject(err);
      else resolve(addrs as Array<{ address: string; family: number }>);
    });
  });

const IP_LITERAL =
  /^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-fA-F:]+\]?|0x[0-9a-fA-F]+|\d{8,})$/;

/**
 * Validate a destination URL and resolve it to a set of allowed connect
 * addresses. Fails closed on any unsafe or unresolvable host.
 */
export async function assertPublicDestination(
  rawUrl: string,
  deps: { lookupAll?: LookupAllFn; allowInsecure?: boolean } = {},
): Promise<AssertOk | AssertFail> {
  const literal = isSafeWebhookUrl(rawUrl, { allowInsecure: deps.allowInsecure });
  if (!literal.ok) return literal;

  const url = new URL(literal.url);
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // A literal IP is already fully judged by `isSafeWebhookUrl`.
  if (IP_LITERAL.test(url.hostname)) {
    return { ok: true, url, addresses: [host] };
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await (deps.lookupAll ?? defaultLookupAll)(host);
  } catch {
    return { ok: false, code: "integrationHub.validation.urlUnresolvable" };
  }
  if (resolved.length === 0) {
    return { ok: false, code: "integrationHub.validation.urlUnresolvable" };
  }

  const allowInsecure =
    deps.allowInsecure ?? process.env.INTEGRATION_ALLOW_INSECURE_URLS === "1";
  for (const { address } of resolved) {
    if (isBlockedIp(address) && !allowInsecure) {
      return { ok: false, code: "integrationHub.validation.urlResolvesPrivate" };
    }
  }

  return { ok: true, url, addresses: resolved.map((r) => r.address) };
}

export interface SafeFetchResult {
  status: number;
  text: () => Promise<string>;
}

/**
 * POST `body` to `url`, pinned to `addresses`. No redirect following. Reads at
 * most `maxResponseBytes` of the response. Rejects on network / TLS / timeout.
 */
export function pinnedPost(
  url: URL,
  addresses: string[],
  init: {
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    maxResponseBytes?: number;
    signal?: AbortSignal;
  },
): Promise<SafeFetchResult> {
  const allowed = new Set(addresses.map((a) => a.replace(/^\[|\]$/g, "")));
  const doRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
  const maxBytes = init.maxResponseBytes ?? 64 * 1024;

  return new Promise<SafeFetchResult>((resolve, reject) => {
    const req = doRequest(
      url,
      {
        method: "POST",
        headers: { ...init.headers, host: url.host },
        signal: init.signal,
        // Pin: only ever connect to a pre-validated address.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lookup: ((_hostname: string, opts: any, cb: any) => {
          const fam = opts?.family;
          const wantV6 = fam === 6 || fam === "IPv6";
          const wantV4 = fam === 4 || fam === "IPv4";
          const clean = addresses.map((a) => a.replace(/^\[|\]$/g, ""));
          const pick =
            (wantV6 && clean.find((a) => a.includes(":"))) ||
            (wantV4 && clean.find((a) => !a.includes(":"))) ||
            clean[0];
          if (!pick || !allowed.has(pick)) {
            cb(new Error("destination address not allowed"), "", 0);
            return;
          }
          cb(null, pick, pick.includes(":") ? 6 : 4);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.length;
          if (total <= maxBytes) chunks.push(c);
          if (total > maxBytes) res.destroy();
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            text: async () => Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );

    const timer = setTimeout(() => req.destroy(new Error("request timed out")), init.timeoutMs);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.on("close", () => clearTimeout(timer));
    req.end(init.body);
  });
}
