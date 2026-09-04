/**
 * Locale-aware date / number formatting. Pure, dependency-free, testable.
 *
 * Both locales are pinned to Saudi Arabia (`en-SA` / `ar-SA`), Latin digits and
 * the Gregorian calendar — an Arabic UI must not silently switch to
 * Arabic-Indic digits or the Hijri calendar (the product expects Gregorian).
 */

import { intlLocale, type Locale } from "./config.ts";

const BASE: Intl.DateTimeFormatOptions = {
  calendar: "gregory",
  numberingSystem: "latn",
};

function dateFormatter(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    ...BASE,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function dateTimeFormatter(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    ...BASE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function numberFormatter(locale: Locale): Intl.NumberFormat {
  return new Intl.NumberFormat(intlLocale(locale), { numberingSystem: "latn" });
}

export function formatDate(
  iso: string | null | undefined,
  locale: Locale = "en",
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFormatter(locale).format(d);
}

export function formatDateTime(
  iso: string | null | undefined,
  locale: Locale = "en",
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFormatter(locale).format(d);
}

export function formatNumber(
  value: number | null | undefined,
  locale: Locale = "en",
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return numberFormatter(locale).format(value);
}

/** `ratio` is 0–1; rendered as a whole-number percent. */
export function formatPercent(
  ratio: number | null | undefined,
  locale: Locale = "en",
): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    numberingSystem: "latn",
    maximumFractionDigits: 0,
  }).format(ratio);
}
