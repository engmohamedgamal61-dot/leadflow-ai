/**
 * Pure route-access policy — the single source of truth for which paths are
 * public and where to send a request that isn't allowed where it's going.
 *
 * Used by `proxy.ts` (the network-boundary gate) and unit-tested directly.
 * The proxy is the security boundary; server components/actions re-check too.
 */

export const LOGIN_PATH = "/login";
export const ONBOARDING_PATH = "/onboarding";
export const APP_HOME_PATH = "/dashboard";

/**
 * Paths reachable without a session. Everything else requires auth.
 * - `/`            public marketing + anonymous demo chat
 * - `/login`, `/signup`  auth entry points
 * - `/auth/*`      Supabase callbacks (email confirm, etc.)
 * - `/api/chat`    the chat endpoint — works signed-in *and* anonymous (demo)
 * - `/api/internal/*`  server-to-server jobs (cron) — the routes enforce their
 *   own secret; the proxy must not redirect them to `/login`.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/login" || pathname === "/signup") {
    return true;
  }
  if (pathname === "/api/chat" || pathname.startsWith("/api/chat/")) {
    return true;
  }
  if (pathname === "/api/internal" || pathname.startsWith("/api/internal/")) {
    return true;
  }
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return true;
  return false;
}

/** Auth pages a signed-in user should be bounced away from. */
export function isAuthEntryPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/signup";
}

export type ProxyDecision =
  | { type: "next" }
  | { type: "redirect"; to: string };

/**
 * Decide what the proxy should do for a request, given only the pathname and
 * whether a valid session exists. Membership is intentionally NOT consulted
 * here — that gate lives in the `/dashboard` and `/onboarding` server
 * components (still server-side, just not in the proxy hot path).
 */
export function decideProxyAction(
  pathname: string,
  hasUser: boolean,
): ProxyDecision {
  if (hasUser && isAuthEntryPath(pathname)) {
    return { type: "redirect", to: APP_HOME_PATH };
  }
  if (isPublicPath(pathname)) {
    return { type: "next" };
  }
  if (!hasUser) {
    return { type: "redirect", to: LOGIN_PATH };
  }
  return { type: "next" };
}
