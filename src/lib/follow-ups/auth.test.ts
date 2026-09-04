import { test } from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqual, extractBearer, checkCronSecret } from "./auth.ts";

const SECRET = "s".repeat(40);

test("timingSafeEqual compares full strings", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
  // @ts-expect-error runtime guard
  assert.equal(timingSafeEqual(null, "x"), false);
});

test("extractBearer parses only a well-formed header", () => {
  assert.equal(extractBearer("Bearer token-123"), "token-123");
  assert.equal(extractBearer("bearer   spaced  "), "spaced");
  assert.equal(extractBearer("Basic abc"), null);
  assert.equal(extractBearer(null), null);
  assert.equal(extractBearer(""), null);
});

test("checkCronSecret accepts the correct secret via either header", () => {
  assert.equal(checkCronSecret(`Bearer ${SECRET}`, null, SECRET), true);
  assert.equal(checkCronSecret(null, SECRET, SECRET), true);
});

test("checkCronSecret rejects wrong / missing / short secrets", () => {
  assert.equal(checkCronSecret(`Bearer ${SECRET}x`, null, SECRET), false);
  assert.equal(checkCronSecret(null, "wrong", SECRET), false);
  assert.equal(checkCronSecret(null, null, SECRET), false);
  assert.equal(checkCronSecret(`Bearer ${SECRET}`, null, undefined), false);
  assert.equal(checkCronSecret(`Bearer short`, null, "short"), false); // secret too short
});
