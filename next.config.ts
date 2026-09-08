import type { NextConfig } from "next";

/**
 * Production security headers.
 *
 * The CSP is deliberately pragmatic (Turbopack/Next inject inline bootstrap
 * scripts and styles; a nonce pipeline is out of scope for the pilot) but
 * still closes the common holes: no plugins, framing locked to same-origin,
 * `connect-src` restricted to self + the Supabase project. The `/embed/*`
 * widget route overrides `frame-ancestors` so a customer can iframe it on
 * their own site.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseHost = (() => {
  try {
    return supabaseUrl ? new URL(supabaseUrl).host : "";
  } catch {
    return "";
  }
})();

const connectSrc = [
  "'self'",
  supabaseUrl || null,
  supabaseHost ? `wss://${supabaseHost}` : null,
]
  .filter(Boolean)
  .join(" ");

// `unsafe-eval` is only needed by the dev bundler (React Refresh); a
// production build never evals. `unsafe-inline` for scripts stays for now —
// Next injects its own inline bootstrap and the app has no inline scripts or
// XSS sinks of its own; a per-request nonce is the follow-up hardening.
const SCRIPT_SRC =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

function csp(frameAncestors: string): string {
  return [
    "default-src 'self'",
    SCRIPT_SRC,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

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
        // The embeddable widget must be frameable by the customer's site.
        // Origin lock-down (per-org allowed_origins) is a follow-up; for the
        // pilot any HTTPS site may embed a widget, and the widget key only
        // routes leads to that org — tenant data stays RLS-isolated.
        source: "/embed/:path*",
        headers: [
          ...baseHeaders,
          {
            key: "Content-Security-Policy",
            value: csp("'self' https: http://localhost:*"),
          },
        ],
      },
      {
        // Everything except the widget route. Next.js applies every matching
        // header block and a later one wins on a duplicate key, so the
        // catch-all must actively exclude `/embed` or it would clobber the
        // widget's relaxed `frame-ancestors` with `DENY`.
        source: "/((?!embed/|embed$).*)",
        headers: [
          ...baseHeaders,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: csp("'none'") },
        ],
      },
    ];
  },
};

export default nextConfig;
