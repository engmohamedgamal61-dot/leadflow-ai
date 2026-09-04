/**
 * Cron/scheduler endpoint authentication — pure. The secret is a server-only
 * env var (`FOLLOW_UP_CRON_SECRET`); it is compared here in constant time and
 * never logged or returned.
 */

/** Constant-time string compare (no early return on length or first mismatch). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Pull the token from `Authorization: Bearer <token>`. */
export function extractBearer(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * True when the request carries the correct scheduler secret, via either
 * `Authorization: Bearer <secret>` or `x-cron-secret: <secret>`. Empty/missing
 * secret config → always false (the route returns 503 separately).
 */
export function checkCronSecret(
  authHeader: string | null | undefined,
  xCronHeader: string | null | undefined,
  secret: string | undefined | null,
): boolean {
  if (typeof secret !== "string" || secret.length < 8) return false;
  const bearer = extractBearer(authHeader);
  if (bearer && timingSafeEqual(bearer, secret)) return true;
  if (
    typeof xCronHeader === "string" &&
    xCronHeader &&
    timingSafeEqual(xCronHeader, secret)
  ) {
    return true;
  }
  return false;
}
