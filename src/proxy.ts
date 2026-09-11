import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { refreshSession, withAuthCookies } from "@/lib/supabase/proxy";
import { decideProxyAction } from "@/lib/auth/route-policy";
import {
  buildCsp,
  frameAncestorsFor,
  generateNonce,
  NONCE_HEADER,
} from "@/lib/security/csp";

/**
 * Network-boundary auth gate + Supabase session refresh + per-request CSP nonce.
 *
 * Runs before every matched route (Node.js runtime). It:
 *   1. mints a CSP nonce and builds the Content-Security-Policy for this
 *      request (production `script-src` is nonce + `strict-dynamic` — no
 *      `unsafe-inline` / `unsafe-eval`),
 *   2. refreshes the Supabase session so downstream code sees a valid token,
 *   3. redirects unauthenticated requests for protected routes to `/login`,
 *   4. bounces signed-in users off `/login` and `/signup`.
 *
 * This is the security boundary — not a convenience. Server Components and
 * Server Actions still re-check auth + membership (defence in depth).
 */
export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    frameAncestors: frameAncestorsFor(request.nextUrl.pathname),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  // Forwarded to the render so Next stamps the nonce onto its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("content-security-policy", csp);

  const { response, user } = await refreshSession(request, requestHeaders);
  const decision = decideProxyAction(request.nextUrl.pathname, Boolean(user));

  const applySecurityHeaders = (res: NextResponse) => {
    res.headers.set("content-security-policy", csp);
    res.headers.set(NONCE_HEADER, nonce);
    return res;
  };

  if (decision.type === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = decision.to;
    url.search = "";
    return applySecurityHeaders(
      withAuthCookies(NextResponse.redirect(url), response),
    );
  }

  return applySecurityHeaders(response);
}

export const config = {
  /**
   * Run on everything except Next internals and static assets. API routes ARE
   * included so their session is refreshed; `route-policy` keeps `/api/chat`
   * public (it serves anonymous demo traffic too). Static assets are excluded —
   * they carry their own content type and need no CSP.
   *
   * `missing` excludes `next/link` PREFETCH requests: a prefetch would be
   * served a fresh per-request nonce, and the chunk it loads would then be
   * blocked by the real navigation's (different) nonce under `strict-dynamic`.
   * Prefetches don't render user-visible HTML and the route-level auth guards
   * still apply, so skipping the proxy for them is safe.
   */
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|widget\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
