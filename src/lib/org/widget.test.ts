import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllowedOrigins } from "./widget.ts";

test("parseAllowedOrigins: normalizes to origins, dedupes, rejects junk", () => {
  const r = parseAllowedOrigins(
    "https://acme.com/contact\nhttps://acme.com\nhttp://localhost:5173\nnot a url",
  );
  assert.deepEqual(r.origins, ["https://acme.com", "http://localhost:5173"]);
  assert.deepEqual(r.invalid, ["not a url"]);
  assert.equal(r.ok, false);
});

test("parseAllowedOrigins: empty input is valid and empty", () => {
  const r = parseAllowedOrigins("");
  assert.deepEqual(r.origins, []);
  assert.equal(r.ok, true);
});

test("parseAllowedOrigins: rejects non-http(s) schemes", () => {
  const r = parseAllowedOrigins("ftp://acme.com\njavascript:alert(1)");
  assert.equal(r.origins.length, 0);
  assert.equal(r.ok, false);
});

test("parseAllowedOrigins: caps the list", () => {
  const many = Array.from({ length: 40 }, (_, i) => `https://s${i}.example.com`).join("\n");
  assert.equal(parseAllowedOrigins(many).origins.length, 20);
});
