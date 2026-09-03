// Value imports use a relative path so this module (and its test) run under
// `node --test`, which does not resolve the `@/` alias for value imports.
import { EMPTY_LEAD, isCoreLeadField, type LeadData } from "../types/chat.ts";
import type { EffectiveConfig, LeadFieldDefinition } from "@/lib/config";

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Multipliers for magnitude words recognised after a number. */
const MAGNITUDE: Array<[RegExp, number]> = [
  [/\b(k|thousand|ألف|الف)\b/, 1_000],
  [/\b(m|mn|million|مليون|ملايين)\b/, 1_000_000],
  [/\b(b|bn|billion|مليار)\b/, 1_000_000_000],
];

const TRUE_WORDS = new Set([
  "true",
  "yes",
  "y",
  "1",
  "نعم",
  "أيوة",
  "ايوه",
  "اه",
]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "لا", "لأ", "كلا"]);

/**
 * Parse a loosely-typed numeric value:
 * `1000000` → 1000000 · `"1,000,000"` → 1000000 · `"1 million"` → 1000000 ·
 * `"1.2m"` → 1200000 · `"800k"` → 800000 · `"٤"` → 4. Returns `null` for
 * anything unparseable. Never throws.
 */
export function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const s = value
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)));
  if (!s) return null;

  const match = s.match(/-?\d[\d,]*\.?\d*/);
  if (!match) return null;
  let n = Number(match[0].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;

  const rest = s.slice((match.index ?? 0) + match[0].length);
  for (const [pattern, multiplier] of MAGNITUDE) {
    if (pattern.test(rest)) {
      n *= multiplier;
      break;
    }
  }
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a loosely-typed boolean:
 * `true`/`"yes"`/`"نعم"`/`"1"` → true · `false`/`"no"`/`"لا"`/`"0"` → false ·
 * anything else → `null`.
 */
export function parseBooleanish(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}

function trimmedText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Match free text against a select field's options, aliases and labels. */
function normalizeSelect(
  value: unknown,
  field: LeadFieldDefinition,
): string | null {
  const text = trimmedText(value);
  if (text === null) return null;
  const lower = text.toLowerCase();

  for (const option of field.options ?? []) {
    const candidates = [option.value, option.label, ...(option.aliases ?? [])];
    if (candidates.some((c) => c.toLowerCase() === lower)) {
      return option.value;
    }
  }
  // Unknown value — keep it, lower-cased, so it stays comparable.
  return lower;
}

/**
 * Normalize one raw value according to its field definition. Pure, never
 * throws, `null`-safe. Normalization is driven entirely by `field.type` — no
 * field-name branches.
 */
export function normalizeFieldValue(
  value: unknown,
  field: LeadFieldDefinition,
): unknown {
  if (value === null || value === undefined) return null;

  switch (field.type) {
    case "number": {
      const n = parseNumeric(value);
      return n === null ? null : Math.round(n);
    }
    case "boolean":
      return parseBooleanish(value);
    case "select":
      return normalizeSelect(value, field);
    case "date":
    case "text":
    default:
      return trimmedText(value);
  }
}

function coreValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Assemble a normalized {@link LeadData} from the raw extraction output and the
 * effective configuration.
 *
 * Each configured (enabled) field is normalized by its type; core fields land
 * on the top level, everything else goes into `customData`. Fields not present
 * in the raw output become `null`. Never throws.
 */
export function assembleLead(
  raw: unknown,
  config: EffectiveConfig,
): LeadData {
  const source: Record<string, unknown> =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const lead: LeadData = {
    ...EMPTY_LEAD,
    customData: {},
  };

  const fields = Array.isArray(config?.leadFields)
    ? config.leadFields.filter((f) => f && f.enabled)
    : [];

  const core = lead as unknown as Record<string, unknown>;
  for (const field of fields) {
    const normalized = normalizeFieldValue(source[field.key], field);
    if (isCoreLeadField(field.key)) {
      core[field.key] = coreValue(normalized);
    } else {
      lead.customData[field.key] = normalized;
    }
  }

  return lead;
}
