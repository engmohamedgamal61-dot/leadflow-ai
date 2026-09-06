/**
 * The application's own public base URL — used to build absolute redirect
 * URIs (Google OAuth) without ever trusting a request's `Host` header.
 * Server-only, read from `APP_BASE_URL` (e.g. `http://localhost:3000` in dev,
 * the deployed origin in production). Must exactly match what's registered as
 * the OAuth redirect URI in the Google Cloud Console.
 */
export function appBaseUrl(): string {
  const url = process.env.APP_BASE_URL;
  if (!url) {
    throw new Error("APP_BASE_URL is not configured");
  }
  return url.replace(/\/+$/, "");
}

/**
 * Non-throwing variant — `null` when `APP_BASE_URL` isn't set. For flows that
 * can still work off a provider's own configured default (e.g. Supabase Auth's
 * Site URL) rather than requiring the env var.
 */
export function appBaseUrlOrNull(): string | null {
  const url = process.env.APP_BASE_URL;
  return url ? url.replace(/\/+$/, "") : null;
}
