/**
 * Lead de-duplication keys for the persistence layer.
 *
 * Pure (runs under `node --test`). A widget visitor often returns in a fresh
 * browser session (no stored `conversationId`), so before creating a new lead
 * we try to match an existing one for the SAME organization by contact detail:
 *
 *  - email → case-insensitive exact match (no collision risk)
 *  - phone → the last 9 significant digits ("national number" for a Saudi
 *            mobile, and the shared tail of every way of writing it), matched
 *            as a suffix. Prefer email when both are present.
 *
 * Phone normalisation is format-agnostic on purpose: `+9665XXXXXXXX`,
 * `009665XXXXXXXX`, `9665XXXXXXXX`, `05XXXXXXXX` and `5XXXXXXXX` are the same
 * Saudi number and ALL end in the same 9 digits, so the suffix key collapses
 * them without needing to know the caller's country.
 */

const PHONE_MATCH_DIGITS = 9;
/** Fewer significant digits than this → too broad to dedup on. */
const PHONE_MIN_SIGNIFICANT_DIGITS = 7;

/** Default country for a bare national number (LeadFlow's pilot market). */
const DEFAULT_COUNTRY_CODE = "966"; // Saudi Arabia
const DEFAULT_NSN_LENGTH = 9; // Saudi mobile national significant number

/** Digits only, `00` international prefix folded to nothing, leading `+` dropped. */
function digitsOnly(raw: string): string {
  let s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  return s.replace(/\D/g, "");
}

/**
 * A canonical E.164-ish string for display / storage consistency. Best-effort:
 * a recognised Saudi shape becomes `+966XXXXXXXXX`; anything already
 * international is kept as `+<digits>`; a short/unknown number is returned as
 * `+<digits>` without further guessing. `null` for junk.
 *
 * NOTE: de-duplication uses {@link phoneMatchKey}, not this — matching must not
 * depend on getting the country guess right.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const hadPlus = raw.trim().startsWith("+") || raw.replace(/\s/g, "").startsWith("00");
  const d = digitsOnly(raw);
  if (d.length < 4) return null;

  if (hadPlus) return `+${d}`;
  if (d.startsWith(DEFAULT_COUNTRY_CODE) && d.length === DEFAULT_COUNTRY_CODE.length + DEFAULT_NSN_LENGTH) {
    return `+${d}`;
  }
  // Bare national number, with or without the trunk `0`.
  if (d.startsWith("0") && d.length === DEFAULT_NSN_LENGTH + 1) {
    return `+${DEFAULT_COUNTRY_CODE}${d.slice(1)}`;
  }
  if (d.length === DEFAULT_NSN_LENGTH && d.startsWith("5")) {
    return `+${DEFAULT_COUNTRY_CODE}${d}`;
  }
  return `+${d}`;
}

/**
 * The suffix key two phone strings must share to be treated as the same number.
 * `null` when the number is too short to be safe to dedup on.
 */
export function phoneMatchKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const d = digitsOnly(raw);
  if (d.length < PHONE_MIN_SIGNIFICANT_DIGITS) return null;
  return d.slice(-PHONE_MATCH_DIGITS);
}

/** Lowercased, trimmed email. `null` for anything without a single `@` and a dot in the domain. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  const at = e.indexOf("@");
  if (at <= 0 || at !== e.lastIndexOf("@")) return null;
  if (!e.slice(at + 1).includes(".")) return null;
  if (/\s/.test(e)) return null;
  return e;
}

export type DedupMatch =
  | { by: "email"; value: string }
  | { by: "phone"; matchKey: string };

/**
 * Choose the strongest available contact key to match an existing lead by.
 * Email first (exact, no collisions), then phone (suffix). `null` when the
 * lead has no usable contact detail yet — a new lead is created.
 */
export function pickDedupMatch(lead: {
  email?: string | null;
  phone?: string | null;
}): DedupMatch | null {
  const email = normalizeEmail(lead.email);
  if (email) return { by: "email", value: email };
  const matchKey = phoneMatchKey(lead.phone);
  if (matchKey) return { by: "phone", matchKey };
  return null;
}

/** Escape LIKE / ILIKE metacharacters so a value is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}
