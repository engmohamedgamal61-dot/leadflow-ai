import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { refreshSession, withAuthCookies } from "@/lib/supabase/proxy";
import { decideProxyAction } from "@/lib/auth/route-policy";

/**
 * Network-boundary auth gate + Supabase session refresh.
 *
 * Runs before every matched route (Node.js runtime). It:
 *   1. refreshes the Supabase session so Server Components / Route Handlers
 *      downstream see a valid, non-expired token,
 *   2. redirects unauthenticated requests for protected routes to `/login`,
 *   3. bounces signed-in users off `/login` and `/signup`.
 *
 * This is the security boundary — not a convenience. Server Components and
 * Server Actions still re-check auth + membership (defence in depth).
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await refreshSession(request);
  const decision = decideProxyAction(request.nextUrl.pathname, Boolean(user));

  if (decision.type === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = decision.to;
    url.search = "";
    return withAuthCookies(NextResponse.redirect(url), response);
  }

  return response;
}

export const config = {
  /**
   * Run on everything except Next internals and static assets. API routes ARE
   * included so their session is refreshed; `route-policy` keeps `/api/chat`
   * public (it serves anonymous demo traffic too).
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
