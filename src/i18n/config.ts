/**
 * Locale core for LeadFlow AI.
 *
 * Pure and dependency-free so it runs under `node --test` and on both the
 * server and the client. No `next/*` imports here.
 */

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Server-readable cookie that persists the user's explicit choice. */
export const LOCALE_COOKIE = "leadflow_locale";

export type Direction = "ltr" | "rtl";

const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["ar"]);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function directionFor(locale: Locale): Direction {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

export function oppositeLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

/** BCP-47 tag used for `Intl` formatters. Region pinned to Saudi Arabia. */
export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-SA" : "en-SA";
}

/** Cookie attributes for the locale cookie. Pure — no `next/*` types. */
export function localeCookieOptions() {
  return {
    path: "/",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 365, // 1 year
    httpOnly: false,
  };
}

/**
 * Parse an `Accept-Language` header value and return `"ar"` when Arabic is the
 * top-ranked language the browser asks for, otherwise `null`.
 */
function preferredFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.split("=")[1]) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const entry of ranked) {
    if (entry.tag === "ar" || entry.tag.startsWith("ar-")) return "ar";
    if (entry.tag === "en" || entry.tag.startsWith("en-")) return "en";
  }
  return null;
}

/**
 * Resolve the active locale for a request.
 *
 *   1. a valid locale cookie always wins (the user's explicit choice),
 *   2. otherwise the browser's `Accept-Language` preference, if it clearly
 *      prefers Arabic or English,
 *   3. otherwise {@link DEFAULT_LOCALE}.
 */
export function resolveLocale(input: {
  cookieValue?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(input.cookieValue)) return input.cookieValue;
  return preferredFromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}
