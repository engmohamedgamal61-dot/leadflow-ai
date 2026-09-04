"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  directionFor,
  intlLocale as toIntlLocale,
  type Direction,
  type Locale,
} from "./config";
import type { Dictionary } from "./dictionaries";
import {
  createOptionalTranslator,
  createTranslator,
  type TranslateFn,
  type TranslateOptionalFn,
} from "./translate";

export interface ClientI18n {
  locale: Locale;
  dir: Direction;
  intlLocale: string;
  dict: Dictionary;
  t: TranslateFn;
  /** Like `t`, but returns `undefined` for a missing key (for fallbacks). */
  tOptional: TranslateOptionalFn;
}

const I18nContext = createContext<ClientI18n | null>(null);

export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo<ClientI18n>(
    () => ({
      locale,
      dir: directionFor(locale),
      intlLocale: toIntlLocale(locale),
      dict,
      t: createTranslator(dict),
      tOptional: createOptionalTranslator(dict),
    }),
    [locale, dict],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): ClientI18n {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an <I18nProvider>");
  }
  return ctx;
}
