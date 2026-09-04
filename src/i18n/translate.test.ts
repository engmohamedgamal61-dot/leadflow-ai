import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectLeafPaths,
  createTranslator,
  hasTranslation,
  translate,
  translateOptional,
} from "./translate.ts";

const TREE = {
  common: { save: "Save", greeting: "Hi {name}!" },
  nested: { deep: { key: "value {a} {b}" } },
  list: ["one", "two"],
};

test("translate resolves dotted paths", () => {
  assert.equal(translate(TREE, "common.save"), "Save");
  assert.equal(translate(TREE, "nested.deep.key", { a: 1, b: "x" }), "value 1 x");
});

test("translate interpolates and leaves unknown placeholders untouched", () => {
  assert.equal(translate(TREE, "common.greeting", { name: "Sara" }), "Hi Sara!");
  assert.equal(translate(TREE, "common.greeting"), "Hi {name}!");
});

test("translate returns the key for a missing path (visible, non-throwing)", () => {
  assert.equal(translate(TREE, "common.missing"), "common.missing");
  assert.equal(translate(TREE, "does.not.exist"), "does.not.exist");
  // an array leaf is not a string → treated as missing
  assert.equal(translate(TREE, "list"), "list");
});

test("translateOptional / hasTranslation report absence", () => {
  assert.equal(translateOptional(TREE, "common.save"), "Save");
  assert.equal(translateOptional(TREE, "common.nope"), undefined);
  assert.equal(hasTranslation(TREE, "nested.deep.key"), true);
  assert.equal(hasTranslation(TREE, "nested.deep.nope"), false);
});

test("createTranslator binds a tree", () => {
  const t = createTranslator(TREE);
  assert.equal(t("common.save"), "Save");
  assert.equal(t("common.greeting", { name: "A" }), "Hi A!");
});

test("collectLeafPaths enumerates every string leaf (arrays indexed)", () => {
  const paths = collectLeafPaths(TREE);
  assert.deepEqual(paths, [
    "common.greeting",
    "common.save",
    "list.0",
    "list.1",
    "nested.deep.key",
  ]);
});
