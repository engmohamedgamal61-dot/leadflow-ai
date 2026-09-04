import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "./dictionaries/en.ts";
import { ar } from "./dictionaries/ar.ts";
import { collectLeafPaths } from "./translate.ts";

const enPaths = collectLeafPaths(en);
const arPaths = collectLeafPaths(ar);
const enSet = new Set(enPaths);
const arSet = new Set(arPaths);

test("Arabic dictionary has every English key (no missing translations)", () => {
  const missing = enPaths.filter((p) => !arSet.has(p));
  assert.deepEqual(missing, [], `missing in ar: ${missing.join(", ")}`);
});

test("English dictionary has every Arabic key (no orphan translations)", () => {
  const extra = arPaths.filter((p) => !enSet.has(p));
  assert.deepEqual(extra, [], `extra in ar: ${extra.join(", ")}`);
});

test("both dictionaries define a meaningful number of keys", () => {
  assert.ok(enPaths.length > 200, `only ${enPaths.length} keys`);
  assert.equal(enPaths.length, arPaths.length);
});

test("no Arabic value is left as the raw English string", () => {
  // A handful are intentionally identical (brand, language names, placeholders).
  const allowedIdentical = new Set([
    "brand.name",
    "brand.initials",
    "languageSwitcher.english",
    "languageSwitcher.arabic",
    "auth.emailPlaceholder",
    "auth.passwordPlaceholder",
    "meta.appTitle",
    "chat.headerTitle",
    "common.emptyValue",
    "leadDetail.conversation.channelStatus",
    "leadDetail.appointments.upcoming",
    "events.appointmentBookedDetail",
  ]);
  const suspicious: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (typeof a === "string" && typeof b === "string") {
      if (a === b && !allowedIdentical.has(path) && /[A-Za-z]{4,}/.test(a)) {
        suspicious.push(path);
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      a.forEach((v, i) => walk(v, b[i], `${path}.${i}`));
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const k of Object.keys(a as object)) {
        walk(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          path ? `${path}.${k}` : k,
        );
      }
    }
  };
  walk(en, ar, "");
  assert.deepEqual(suspicious, [], `untranslated: ${suspicious.join(", ")}`);
});
