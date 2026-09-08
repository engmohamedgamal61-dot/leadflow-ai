/**
 * A client-supplied post-auth destination is only honored when it is a
 * genuinely local path. Shared by the auth server actions, the login/signup
 * pages, and the `/auth/confirm` callback.
 *
 * Rejected: anything not starting with a single `/`, protocol-relative (`//`
 * or `/\`, which some browsers read as another host), a scheme (`/https:…`),
 * backslashes, and ASCII control / whitespace characters (CR/LF header
 * injection, tab-splitting). `new URL(path, origin)` also forces the origin
 * downstream, so this is defence-in-depth on top of that.
 */

// Control chars (0x00–0x1F), space (0x20), and DEL (0x7F).
const CONTROL_OR_SPACE = new RegExp("[\\u0000-\\u0020\\u007f]");
// A leading `/…/https:` style scheme smuggle.
const LEADING_SCHEME = /^\/+[a-z][a-z0-9+.-]*:/i;

export function safeNextPath(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;

  const value = raw.trim();
  if (
    value.length === 0 ||
    value.length > 512 ||
    value[0] !== "/" || // must be root-relative
    value[1] === "/" || // "//evil.com"
    value[1] === "\\" || // "/\evil.com"
    value.includes("\\") || // any backslash
    CONTROL_OR_SPACE.test(value) ||
    LEADING_SCHEME.test(value)
  ) {
    return fallback;
  }
  return value;
}
