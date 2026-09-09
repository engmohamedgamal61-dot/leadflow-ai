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
