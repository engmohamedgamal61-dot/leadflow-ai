/**
 * Origin allowlisting for the public website widget.
 *
 * The widget is served from our origin inside an `<iframe>` on the customer's
 * site, so a request's `Origin`/`Referer` header is *our* origin, not the
 * embedding page's. The embedding origin is established from, in order of
 * trust:
 *
 *   1. a cross-site `Referer` on the `/embed/<key>` navigation (browser-set),
 *   2. a non-first-party `Origin`/`Referer` header on `/api/chat` (only real
 *      when the widget is embedded cross-origin without our iframe),
 *   3. `window.location.ancestorOrigins` / `document.referrer` reported by the
 *      widget script in the request body (best-effort; a browser can't forge
 *      its own ancestor chain, but a non-browser caller can send anything).
 *
 * None of these is bulletproof against a hand-crafted request — that's the
 * nature of origin checks — but together they stop a copied widget key from
 * working on a site the organization didn't authorize, from a real browser.
 *
 * Pure module: no I/O, no `process.env` reads except the explicit dev-origin
 * gate. The DB-backed allowlist and the enforcement wiring live in
 * `widget.ts` / `chat-organization.ts` / the `/embed` + `/api/chat` handlers.
 */

const LOCALHOST_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "0.0.0.0",
]);

/**
 * Parse an arbitrary string into a canonical `scheme://host[:port]` origin.
 * `null` for anything that isn't a syntactically valid http(s) URL — including
 * the literal `"null"` origin browsers send for opaque/sandboxed frames.
 */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** A loopback origin — allowed implicitly only when dev origins are enabled. */
export function isLocalhostOrigin(origin: string): boolean {
  try {
    return LOCALHOST_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Whether loopback origins are implicitly allowed even when they're not in an
 * organization's list. True outside production, or when `WIDGET_ALLOW_DEV_ORIGINS=1`
 * is set explicitly (e.g. a staging box that must accept `http://localhost`).
 */
export function devOriginsAllowed(): boolean {
  return (
    process.env.WIDGET_ALLOW_DEV_ORIGINS === "1" ||
    process.env.NODE_ENV !== "production"
  );
}

export type WidgetOriginDecision =
  | {
      allowed: true;
      origin: string;
      reason: "allowlisted" | "dev-localhost" | "no-allowlist";
    }
  | {
      allowed: false;
      reason: "missing" | "malformed" | "not-allowed";
      origin: string | null;
    };

/**
 * `https://acme.com` and `https://www.acme.com` are the same site to a human —
 * expand each allowlist entry to both forms (scheme is left exact: an `http`
 * entry never authorises `https` or vice versa).
 */
function expandWwwVariants(origin: string): string[] {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const other = host.startsWith("www.")
      ? host.slice(4)
      : `www.${host}`;
    const port = url.port ? `:${url.port}` : "";
    return [origin, `${url.protocol}//${other}${port}`];
  } catch {
    return [origin];
  }
}

/**
 * Decide whether `candidate` (a raw origin/URL string, or nothing) is allowed
 * to use a widget whose configured origins are `allowedOrigins`.
 *
 * - nothing supplied              → `missing`
 * - supplied but not a URL        → `malformed`
 * - `allowedOrigins` empty + `emptyAllowsAll` → allowed (`no-allowlist`)
 * - origin (www-insensitive) in list         → allowed (`allowlisted`)
 * - loopback + `allowDevOrigins`             → allowed (`dev-localhost`)
 * - otherwise                                → `not-allowed`
 *
 * `emptyAllowsAll` is the MVP default for the chat/embed paths: a widget with
 * no configured sites runs anywhere. A NON-empty list is always strictly
 * enforced. Without the flag an empty list blocks everything (the stricter
 * default the dashboard writes for).
 */
export function evaluateWidgetOrigin(
  candidate: string | null | undefined,
  allowedOrigins: readonly string[],
  opts: { allowDevOrigins?: boolean; emptyAllowsAll?: boolean } = {},
): WidgetOriginDecision {
  const supplied = typeof candidate === "string" && candidate.trim() !== "";
  const origin = normalizeOrigin(candidate);

  const configured = allowedOrigins
    .map((o) => normalizeOrigin(o))
    .filter((o): o is string => o !== null);

  if (!origin) {
    // With no allowlist and `emptyAllowsAll`, a missing/opaque origin (direct
    // visit, sandboxed frame) is still allowed — there is nothing to check.
    if (configured.length === 0 && (opts.emptyAllowsAll ?? false)) {
      return { allowed: true, origin: origin ?? "", reason: "no-allowlist" };
    }
    return {
      allowed: false,
      reason: supplied && candidate!.trim().toLowerCase() !== "null" ? "malformed" : "missing",
      origin: null,
    };
  }

  if (configured.length === 0 && (opts.emptyAllowsAll ?? false)) {
    return { allowed: true, origin, reason: "no-allowlist" };
  }

  const allowSet = new Set(configured.flatMap(expandWwwVariants));
  if (allowSet.has(origin)) {
    return { allowed: true, origin, reason: "allowlisted" };
  }
  if ((opts.allowDevOrigins ?? false) && isLocalhostOrigin(origin)) {
    return { allowed: true, origin, reason: "dev-localhost" };
  }
  return { allowed: false, reason: "not-allowed", origin };
}

/**
 * Pick the embedding-origin candidate for `/api/chat` from the request's
 * headers and the widget script's self-reported origin. A header value equal to
 * our own app origin is discarded — that's the iframe, not the host page.
 */
export function widgetOriginCandidate(input: {
  originHeader: string | null | undefined;
  refererHeader: string | null | undefined;
  declared: string | null | undefined;
  appOrigin: string | null | undefined;
}): string | null {
  const appOrigin = normalizeOrigin(input.appOrigin);
  const fromHeader = (raw: string | null | undefined): string | null => {
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const normalized = normalizeOrigin(raw);
    if (normalized && appOrigin && normalized === appOrigin) return null;
    return raw;
  };
  const declared =
    typeof input.declared === "string" && input.declared.trim() !== ""
      ? input.declared
      : null;
  return fromHeader(input.originHeader) ?? fromHeader(input.refererHeader) ?? declared;
}
