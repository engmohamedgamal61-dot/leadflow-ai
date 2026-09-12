// Real-session dashboard auth for k6 — no application code changes needed.
//
// Signs in against the real Supabase GoTrue REST API (the same endpoint the
// browser's @supabase/ssr client calls), then constructs the exact cookie
// @supabase/ssr's server client reads (verified against
// node_modules/@supabase/ssr/dist/main/cookies.js and
// node_modules/@supabase/supabase-js/dist/index.cjs's defaultStorageKey):
//   name:  sb-<url-hostname-first-label>-auth-token
//   value: "base64-" + base64url(JSON.stringify(session))
// Chunked into NAME.0, NAME.1, ... above @supabase/ssr's 3180-byte MAX_CHUNK_SIZE
// (this app's session/user payload is well under that — single cookie).
import http from "k6/http";
import encoding from "k6/encoding";
import { check } from "k6";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_COOKIE_NAME, APP_URL } from "./config.js";

const MAX_CHUNK_SIZE = 3180;

/**
 * Signs in as `email`/`password` and sets the resulting session cookie(s) in
 * `jar` for APP_URL, so subsequent requests through that jar are
 * authenticated exactly like a real browser session.
 */
export function loginAndSetCookie(jar, email, password) {
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY } },
  );
  const ok = check(res, { "login: 200": (r) => r.status === 200 });
  if (!ok) return false;

  const session = res.json();
  const json = JSON.stringify(session);
  const value = "base64-" + encoding.b64encode(json, "rawurl");

  const appUrlObj = APP_URL;
  if (value.length <= MAX_CHUNK_SIZE) {
    jar.set(appUrlObj, AUTH_COOKIE_NAME, value);
  } else {
    for (let i = 0; i * MAX_CHUNK_SIZE < value.length; i += 1) {
      const chunk = value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE);
      jar.set(appUrlObj, `${AUTH_COOKIE_NAME}.${i}`, chunk);
    }
  }
  return true;
}
