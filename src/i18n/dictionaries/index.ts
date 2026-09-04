import type { Locale } from "../config.ts";
import { en, type Dictionary } from "./en.ts";
import { ar } from "./ar.ts";

export type { Dictionary } from "./en.ts";

export const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
