import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  directionFor,
  intlLocale,
  isLocale,
  localeCookieOptions,
  oppositeLocale,
  resolveLocale,
} from "./config.ts";

test("isLocale narrows to the supported set", () => {
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("ar"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(isLocale(""), false);
  assert.equal(isLocale(undefined), false);
  assert.equal(isLocale(42), false);
});

test("directionFor maps ar → rtl, en → ltr", () => {
  assert.equal(directionFor("ar"), "rtl");
  assert.equal(directionFor("en"), "ltr");
});

test("oppositeLocale + intlLocale", () => {
  assert.equal(oppositeLocale("en"), "ar");
  assert.equal(oppositeLocale("ar"), "en");
  assert.equal(intlLocale("ar"), "ar-SA");
  assert.equal(intlLocale("en"), "en-SA");
});

test("resolveLocale: a valid cookie always wins", () => {
  assert.equal(
    resolveLocale({ cookieValue: "ar", acceptLanguage: "en-US,en;q=0.9" }),
    "ar",
  );
  assert.equal(
    resolveLocale({ cookieValue: "en", acceptLanguage: "ar-SA,ar;q=0.9" }),
    "en",
  );
});

test("resolveLocale: falls back to Accept-Language when no cookie", () => {
  assert.equal(
    resolveLocale({ cookieValue: null, acceptLanguage: "ar-SA,ar;q=0.9,en;q=0.4" }),
    "ar",
  );
  assert.equal(
    resolveLocale({ cookieValue: "  ", acceptLanguage: "fr-FR,fr;q=0.9,ar;q=0.2" }),
    "ar",
  );
  assert.equal(
    resolveLocale({ cookieValue: undefined, acceptLanguage: "en-GB,en;q=0.9" }),
    "en",
  );
});

test("resolveLocale: q-ranking respects the strongest preference", () => {
  assert.equal(
    resolveLocale({ cookieValue: null, acceptLanguage: "en;q=0.8, ar;q=0.9" }),
    "ar",
  );
  assert.equal(
    resolveLocale({ cookieValue: null, acceptLanguage: "ar;q=0.3, en;q=0.9" }),
    "en",
  );
});

test("resolveLocale: default when nothing matches", () => {
  assert.equal(resolveLocale({}), DEFAULT_LOCALE);
  assert.equal(
    resolveLocale({ cookieValue: "de", acceptLanguage: "de-DE,de;q=0.9" }),
    DEFAULT_LOCALE,
  );
  assert.equal(DEFAULT_LOCALE, "en");
});

test("localeCookieOptions is a plain, long-lived, lax cookie", () => {
  const opts = localeCookieOptions();
  assert.equal(opts.path, "/");
  assert.equal(opts.sameSite, "lax");
  assert.equal(opts.httpOnly, false);
  assert.ok(opts.maxAge >= 60 * 60 * 24 * 300);
});
