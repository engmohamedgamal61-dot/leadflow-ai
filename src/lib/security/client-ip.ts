/**
 * Client IP extraction for rate-limit keys. Pure.
 *
 * `X-Forwarded-For` is fully attacker-controlled — the client can send any
 * value, and a reverse proxy *appends* the real connecting IP rather than
 * replacing the header. So this uses a deployment-aware strategy:
 *
 *  1. `RATE_LIMIT_CLIENT_IP_HEADER` — if set, the name of a header the platform
 *     populates with the true client IP and strips from client input
 *     (`x-real-ip` on most nginx/Ingress setups, `cf-connecting-ip` on
 *     Cloudflare, `x-vercel-forwarded-for` / `true-client-ip`, `fly-client-ip`).
 *     When present this is trusted verbatim.
 *
 *  2. Otherwise, parse `X-Forwarded-For` as `client, proxy1, proxy2, …` and
 *     take the entry `RATE_LIMIT_TRUSTED_PROXY_HOPS` from the RIGHT. Every hop
 *     you control appends one entry, so with 1 trusted proxy the real client
 *     is the last entry — and a client that pre-seeds `X-Forwarded-For: 1.2.3.4`
 *     just pushes its spoofed value further left, where it is ignored.
 *     Default hops = 1 (one reverse proxy, the near-universal case).
 *
 *  3. Fall back to `x-real-ip`, then `"unknown"`.
 *
 * A wrong value only mis-buckets *that request's* per-IP limit; the per-org and
 * per-widget caps are the real backstop and are unaffected. See
 * `docs/PRODUCTION-SECURITY.md` for the exact header to configure per platform.
 */

interface HeaderBag {
  get(name: string): string | null;
}

export interface ClientIpConfig {
  /** Trusted single-IP header name, lowercased. */
  trustedHeader?: string | null;
  /** How many trailing `X-Forwarded-For` entries your infrastructure adds. */
  trustedProxyHops: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function clientIpConfigFromEnv(): ClientIpConfig {
  const trustedHeader = process.env.RATE_LIMIT_CLIENT_IP_HEADER?.trim().toLowerCase();
  return {
    trustedHeader: trustedHeader || null,
    trustedProxyHops: envInt("RATE_LIMIT_TRUSTED_PROXY_HOPS", 1),
  };
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/** Loose but sufficient shape check for a rate-limit bucket key. */
function looksLikeIp(value: string): boolean {
  const v = value.trim().replace(/^\[|\]$/g, "").split("%")[0]; // strip zone id
  if (!v || v.length > 45) return false;
  if (IPV4.test(v)) return v.split(".").every((o) => Number(o) <= 255);
  return v.includes(":") && IPV6.test(v);
}

function firstValidHop(csv: string | null): string | null {
  if (!csv) return null;
  for (const part of csv.split(",")) {
    const t = part.trim();
    if (looksLikeIp(t)) return t;
  }
  return null;
}

/**
 * Resolve the client IP for a rate-limit key.
 *
 * @param headers  the request headers
 * @param config   deployment config; defaults to {@link clientIpConfigFromEnv}
 */
export function clientIp(headers: HeaderBag, config?: ClientIpConfig): string {
  const cfg = config ?? clientIpConfigFromEnv();

  if (cfg.trustedHeader) {
    const trusted = firstValidHop(headers.get(cfg.trustedHeader));
    if (trusted) return trusted;
  }

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const hops = Math.max(1, cfg.trustedProxyHops);
      const idx = Math.max(0, parts.length - hops);
      const candidate = parts[idx];
      if (candidate && looksLikeIp(candidate)) return candidate;
      // The chosen slot is garbage — scan the rest for anything IP-shaped.
      const anyValid = [...parts].reverse().find((p) => looksLikeIp(p));
      if (anyValid) return anyValid;
    }
  }

  const real = firstValidHop(headers.get("x-real-ip"));
  if (real) return real;

  return "unknown";
}
