/**
 * Runs once when the server process starts (Next.js `register` hook).
 *
 * In production it fails the boot when a security-critical secret is missing or
 * still a development placeholder, and logs loud warnings for the Supabase
 * dashboard settings the app cannot verify on its own. See
 * `src/lib/security/production-readiness.ts` and `docs/PRODUCTION-SECURITY.md`.
 */
export async function register() {
  // Skip during `next build` (no server is being served yet).
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Edge runtime has no filesystem / secrets model we gate on here.
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { assertProductionReadiness } = await import(
    "@/lib/security/production-readiness"
  );
  assertProductionReadiness();
}

/**
 * The vendor-agnostic error-tracking integration point — Next.js calls this
 * for any server error it captures that reached ITS boundary (Server
 * Components, Server Actions, an uncaught throw in a Route Handler). Every
 * route this app cares most about (`/api/chat`, the WhatsApp webhook, the
 * integration worker) already catches and reports its own errors via
 * `reportError` with richer context (requestId, organizationId); this is the
 * backstop for everything else, reusing the same sink.
 *
 * To add a real error-tracking provider (Sentry, Datadog, etc.) in
 * production: install its SDK, then call its `captureException`/
 * `captureRequestError` here alongside (or instead of) `reportError` — see
 * docs/PRODUCTION-HARDENING.md. No such SDK is installed today; this stays
 * dependency-free until one is actually needed.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const { reportError } = await import("@/lib/observability/report");
  await reportError(error, {
    scope: "next.onRequestError",
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    requestMethod: request.method,
    // Strip the query string — it can carry an OAuth `code`/`state` or other
    // short-lived sensitive value that isn't a "secret-shaped" token
    // `reportError`'s redaction would catch.
    requestPath: request.path.split("?")[0],
  });
}
