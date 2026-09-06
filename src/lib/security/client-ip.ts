/**
 * Best-effort client IP extraction for rate-limit keys. Pure.
 *
 * Behind Vercel / a reverse proxy the real client IP is the FIRST hop of
 * `x-forwarded-for`; `x-real-ip` is the fallback. This is a rate-limit key,
 * not an authorization input — a spoofed value only lets an attacker rate-
 * limit themselves under a different bucket, and the per-widget/per-org limit
 * still caps the blast radius.
 */
export function clientIp(headers: {
  get(name: string): string | null;
}): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  return "unknown";
}
