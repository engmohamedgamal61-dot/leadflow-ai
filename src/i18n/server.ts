import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import {
  directionFor,
  intlLocale,
  LOCALE_COOKIE,
  resolveLocale,
  type Direction,
  type Locale,
} from "./config.ts";
import { dictionaryFor, type Dictionary } from "./dictionaries/index.ts";
import {
  createOptionalTranslator,
  createTranslator,
  type TranslateFn,
  type TranslateOptionalFn,
} from "./translate.ts";

/**
 * The active locale for this request. Resolution: a valid locale cookie wins,
 * else the `Accept-Language` header, else the default. `cache()` dedupes the
 * `cookies()` / `headers()` reads across a single render pass.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    cookieValue: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get("accept-language"),
  });
});

export async function getDictionary(): Promise<Dictionary> {
  return dictionaryFor(await getLocale());
}

export interface ServerI18n {
  locale: Locale;
  dir: Direction;
  intlLocale: string;
  dict: Dictionary;
  t: TranslateFn;
  tOptional: TranslateOptionalFn;
}

/** Everything a Server Component needs to render in the active locale. */
export const getI18n = cache(async (): Promise<ServerI18n> => {
  const locale = await getLocale();
  const dict = dictionaryFor(locale);
  return {
    locale,
    dir: directionFor(locale),
    intlLocale: intlLocale(locale),
    dict,
    t: createTranslator(dict),
    tOptional: createOptionalTranslator(dict),
  };
});
