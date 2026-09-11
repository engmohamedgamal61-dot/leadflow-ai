import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAppOrigin,
  widgetEmbedSnippet,
  widgetPreviewUrl,
  widgetScriptUrl,
} from "./widget-embed.ts";

const KEY = "550e8400-e29b-41d4-a716-446655440000";

test("normalizeAppOrigin: strips path/query/trailing slash; null/empty → empty string", () => {
  assert.equal(normalizeAppOrigin("https://app.example.com/"), "https://app.example.com");
  assert.equal(normalizeAppOrigin("https://app.example.com/some/path?x=1"), "https://app.example.com");
  assert.equal(normalizeAppOrigin(null), "");
  assert.equal(normalizeAppOrigin(""), "");
});

test("widgetScriptUrl / widgetPreviewUrl point at the right paths", () => {
  assert.equal(widgetScriptUrl("https://app.example.com"), "https://app.example.com/widget.js");
  assert.equal(
    widgetPreviewUrl("https://app.example.com", KEY),
    `https://app.example.com/embed/${KEY}`,
  );
});

test("widgetEmbedSnippet: a script tag with the origin's widget.js and the key as an attribute", () => {
  const snippet = widgetEmbedSnippet("https://app.example.com", KEY);
  assert.ok(snippet.includes('src="https://app.example.com/widget.js"'));
  assert.ok(snippet.includes(`data-widget-key="${KEY}"`));
  assert.ok(snippet.startsWith("<script"));
  assert.ok(snippet.trim().endsWith("</script>"));
  assert.ok(snippet.includes("async"));
});

test("widgetEmbedSnippet: an invalid (non-UUID) key never renders a snippet", () => {
  assert.equal(widgetEmbedSnippet("https://app.example.com", "not-a-key"), "");
  assert.equal(widgetEmbedSnippet("https://app.example.com", "<script>alert(1)</script>"), "");
});

test("widgetEmbedSnippet: works even with no known app origin (relative-looking, still safe)", () => {
  const snippet = widgetEmbedSnippet(null, KEY);
  assert.ok(snippet.includes('src="/widget.js"'));
});
