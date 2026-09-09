/**
 * Content-Security-Policy construction for the proxy (middleware).
 *
 * Production `script-src` is `'self' 'nonce-<n>'` — no `unsafe-inline`, no
 * `unsafe-eval`. A fresh nonce is minted per request in `proxy.ts`, written to
 * both the request headers (so Next's SSR stamps it onto its framework and
 * chunk-loader scripts) and the response headers. Every route in this app is
 * already dynamically rendered (the root layout reads cookies via `getI18n`),
 * which is the precondition for nonce support.
 *
 * `'strict-dynamic'` is intentionally NOT used: it disables the `'self'`
 * allowlist, and Next's client router prefetches route chunks via `<link>`
 * hints that `'strict-dynamic'` does not cover, so those loads would be
 * blocked. `'self' + nonce` still blocks every XSS lever — no inline script
 * without the (per-request, unguessable) nonce, and no off-origin script —
 * while letting Next load its own same-origin chunks.
 *
 * `style-src` keeps `unsafe-inline`: React renders `style="…"` attributes
 * across the dashboard and a nonce does not cover attribute-level styles.
 * Style injection cannot execute script, so this is an accepted residual — the
 * XSS-relevant lever is `script-src`, which is now strict.
 *
 * Pure and dependency-light so the header string is unit-tested directly.
 */

export const NONCE_HEADER = "x-nonce";

/** 16 random bytes, base64 — unpredictable and unique per request. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /**
   * `frame-ancestors` value. `'none'` everywhere except the embeddable widget,
   * which a customer must be able to iframe on their own site.
   */
  frameAncestors: string;
  /** `NEXT_PUBLIC_SUPABASE_URL` — added to `connect-src` for realtime + REST. */
  supabaseUrl?: string | null;
}

/** Build the CSP header value. */
export function buildCsp(opts: CspOptions): string {
  const { nonce, isDev, frameAncestors } = opts;

  // Dev needs `unsafe-eval` (React Refresh); production does not. `'self'`
  // covers Next's same-origin chunk + prefetch loads; the nonce covers Next's
  // inline bootstrap / RSC-payload scripts. No `unsafe-inline` either way.
  const scriptSrc = [
    "script-src 'self'",
    `'nonce-${nonce}'`,
    isDev ? "'unsafe-eval'" : null,
  ]
    .filter(Boolean)
    .join(" ");

  let supabaseHost = "";
  try {
    supabaseHost = opts.supabaseUrl ? new URL(opts.supabaseUrl).host : "";
  } catch {
    supabaseHost = "";
  }
  const connectSrc = [
    "connect-src 'self'",
    opts.supabaseUrl || null,
    supabaseHost ? `wss://${supabaseHost}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    scriptSrc,
    // See the module comment: `unsafe-inline` stays for `style=` attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    connectSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

/** `frame-ancestors` for a given request path. */
export function frameAncestorsFor(pathname: string): string {
  // The embeddable widget must be frameable by the customer's authorised site.
  // The `/embed` page itself enforces the per-org origin allowlist; `https:`
  // here just permits the outer frame, it does not authorise the chat.
  if (pathname === "/embed" || pathname.startsWith("/embed/")) {
    return "'self' https: http://localhost:*";
  }
  return "'none'";
}
