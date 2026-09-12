// Shared k6 config — Enterprise Readiness load-test harness. Not application
// code; reads only what the seed script wrote.
import { SharedArray } from "k6/data";

export const APP_URL = __ENV.APP_URL || "http://localhost:3100";
export const SUPABASE_URL = __ENV.SUPABASE_URL || "http://127.0.0.1:54321";

// No hardcoded fallback, even the public local-dev demo key — required so
// nothing JWT-shaped ever sits in this file. Pass the anon key k6 sees in
// `npx supabase status` (or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local).
export const SUPABASE_ANON_KEY = (() => {
  const key = __ENV.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_ANON_KEY is required. Pass it with -e SUPABASE_ANON_KEY=<key> " +
        "— the same value as NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, or " +
        "the ANON_KEY field from `npx supabase status`.",
    );
  }
  return key;
})();
// Simulated customer-site origin, matching what seed.mjs put in every org's
// organization_widget_settings.allowed_origins.
export const WIDGET_ORIGIN = "http://localhost:3000";
// Matches @supabase/supabase-js's defaultStorageKey derivation
// (`sb-${new URL(url).hostname.split(".")[0]}-auth-token`) for 127.0.0.1.
export const AUTH_COOKIE_NAME = "sb-127-auth-token";

export const orgs = new SharedArray("orgs", function () {
  const raw = JSON.parse(open("../../results/seed-data.json"));
  return raw.orgs;
});

export function pickOrg(vuOrIterId) {
  return orgs[vuOrIterId % orgs.length];
}

/** A stable-per-VU synthetic client IP so per-IP rate limiting sees distinct callers. */
export function syntheticIp(vuId) {
  const a = 10;
  const b = (vuId >> 16) & 0xff;
  const c = (vuId >> 8) & 0xff;
  const d = vuId & 0xff;
  return `${a}.${b}.${c}.${d}`;
}
