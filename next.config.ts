import type { NextConfig } from "next";

/**
 * Static security headers.
 *
 * The Content-Security-Policy is NOT here — it is minted per request in
 * `src/proxy.ts` with a fresh nonce (production `script-src` is
 * `'nonce-…' 'strict-dynamic'`, no `unsafe-inline` / `unsafe-eval`). These
 * headers are request-independent and safe to set statically.
 *
 * `X-Frame-Options` is kept as a legacy backstop for `frame-ancestors`:
 * `DENY` everywhere except `/embed/*`, which a customer must be able to iframe
 * on their own (allowlisted) site.
 */
const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The embeddable widget must be frameable by the customer's site;
        // `frame-ancestors` (set in the proxy) scopes it. No X-Frame-Options.
        source: "/embed/:path*",
        headers: baseHeaders,
      },
      {
        // The widget loader script — fetched cross-origin via a classic
        // `<script src>` (no CORS needed for that), but declared explicitly in
        // case a host ever fetches it directly. Short cache so a rotated key's
        // embed / a script fix reaches sites quickly without being un-cacheable.
        source: "/widget.js",
        headers: [
          ...baseHeaders,
          { key: "Content-Type", value: "text/javascript; charset=utf-8" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
        ],
      },
      {
        // Everything except the widget route. Next.js applies every matching
        // header block and a later one wins on a duplicate key, so the
        // catch-all must actively exclude `/embed` or it would clobber the
        // widget's framing allowance with `DENY`.
        source: "/((?!embed/|embed$).*)",
        headers: [...baseHeaders, { key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
