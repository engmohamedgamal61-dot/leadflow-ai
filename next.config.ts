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
