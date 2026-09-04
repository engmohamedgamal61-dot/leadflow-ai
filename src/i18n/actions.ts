"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  isLocale,
  LOCALE_COOKIE,
  localeCookieOptions,
  type Locale,
} from "./config.ts";

/**
 * Persist the user's explicit locale choice in a server-readable cookie so the
 * next request is server-rendered in that locale (no flash, survives refresh
 * and navigation). Unknown values are ignored.
 */
export async function setLocaleAction(next: string): Promise<{ locale: Locale } | { error: true }> {
  if (!isLocale(next)) return { error: true };

  const store = await cookies();
  store.set(LOCALE_COOKIE, next, localeCookieOptions());

  // Every route reads the locale in the root layout → revalidate the whole tree.
  revalidatePath("/", "layout");
  return { locale: next };
}
