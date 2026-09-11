import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateWidgetOrigin,
  isLocalhostOrigin,
  normalizeOrigin,
  widgetOriginCandidate,
} from "./widget-origin.ts";

const ACME = ["https://www.acme.com", "https://acme.com"];

test("normalizeOrigin: canonicalizes, lowercases, drops path/query", () => {
  assert.equal(normalizeOrigin("https://WWW.Acme.com/contact?x=1"), "https://www.acme.com");
  assert.equal(normalizeOrigin("http://localhost:5173"), "http://localhost:5173");
});

test("normalizeOrigin: rejects junk, non-http schemes, and the opaque 'null' origin", () => {
  assert.equal(normalizeOrigin("not a url"), null);
  assert.equal(normalizeOrigin("javascript:alert(1)"), null);
  assert.equal(normalizeOrigin("ftp://acme.com"), null);
  assert.equal(normalizeOrigin("null"), null);
  assert.equal(normalizeOrigin(""), null);
  assert.equal(normalizeOrigin(null), null);
});

test("allowed origin → allowed (allowlisted)", () => {
  const d = evaluateWidgetOrigin("https://www.acme.com", ACME);
  assert.deepEqual(d, { allowed: true, origin: "https://www.acme.com", reason: "allowlisted" });
});

test("allowed origin match ignores path and case", () => {
  const d = evaluateWidgetOrigin("https://ACME.com/pricing", ACME);
  assert.equal(d.allowed, true);
});

test("blocked origin → not-allowed", () => {
  const d = evaluateWidgetOrigin("https://evil.example", ACME);
  assert.deepEqual(d, { allowed: false, reason: "not-allowed", origin: "https://evil.example" });
});

test("cross-org origin → not-allowed (org B's site can't use org A's widget)", () => {
  const orgA = ["https://a-customer.com"];
  const d = evaluateWidgetOrigin("https://b-customer.com", orgA);
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "not-allowed");
});

test("missing origin → missing", () => {
  assert.deepEqual(evaluateWidgetOrigin(undefined, ACME), {
    allowed: false,
    reason: "missing",
    origin: null,
  });
  assert.equal(evaluateWidgetOrigin("", ACME).reason, "missing");
  assert.equal(evaluateWidgetOrigin("   ", ACME).reason, "missing");
  // The opaque "null" origin (sandboxed iframe / file://) is treated as missing.
  assert.equal(evaluateWidgetOrigin("null", ACME).reason, "missing");
});

test("malformed origin → malformed", () => {
  assert.equal(evaluateWidgetOrigin("https://", ACME).reason, "malformed");
  assert.equal(evaluateWidgetOrigin("acme dot com", ACME).reason, "malformed");
  assert.equal(evaluateWidgetOrigin("data:text/html,x", ACME).reason, "malformed");
});

test("empty allowlist blocks every real origin by default (closed, not open)", () => {
  assert.equal(evaluateWidgetOrigin("https://www.acme.com", []).allowed, false);
  assert.equal(evaluateWidgetOrigin("https://www.acme.com", []).reason, "not-allowed");
});

test("MVP widget/embed policy: emptyAllowsAll lets an unconfigured widget run anywhere", () => {
  const d = evaluateWidgetOrigin("https://anywhere.example", [], { emptyAllowsAll: true });
  assert.deepEqual(d, { allowed: true, origin: "https://anywhere.example", reason: "no-allowlist" });
  // even a missing/opaque origin is fine when there's nothing to check against
  assert.equal(evaluateWidgetOrigin(undefined, [], { emptyAllowsAll: true }).allowed, true);
  assert.equal(evaluateWidgetOrigin("null", [], { emptyAllowsAll: true }).allowed, true);
});

test("emptyAllowsAll never overrides a NON-empty allowlist — it stays strictly enforced", () => {
  const d = evaluateWidgetOrigin("https://evil.example", ACME, { emptyAllowsAll: true });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "not-allowed");
  assert.equal(
    evaluateWidgetOrigin("https://www.acme.com", ACME, { emptyAllowsAll: true }).allowed,
    true,
  );
});

test("www / non-www of an allowlisted host are treated as the same site (scheme stays exact)", () => {
  const bare = ["https://acme.com"];
  assert.equal(evaluateWidgetOrigin("https://www.acme.com", bare).allowed, true);
  assert.equal(evaluateWidgetOrigin("https://acme.com", bare).allowed, true);
  // a different scheme is NOT auto-allowed even with the same host
  assert.equal(evaluateWidgetOrigin("http://acme.com", bare).allowed, false);
  assert.equal(evaluateWidgetOrigin("http://www.acme.com", bare).allowed, false);

  const withWww = ["https://www.shop.acme.com"];
  assert.equal(evaluateWidgetOrigin("https://shop.acme.com", withWww).allowed, true);
});

test("localhost/dev: allowed only when allowDevOrigins is set", () => {
  assert.equal(evaluateWidgetOrigin("http://localhost:3000", ACME).allowed, false);
  const dev = evaluateWidgetOrigin("http://localhost:3000", ACME, { allowDevOrigins: true });
  assert.deepEqual(dev, {
    allowed: true,
    origin: "http://localhost:3000",
    reason: "dev-localhost",
  });
  // 127.0.0.1 / ::1 are loopback too.
  assert.equal(
    evaluateWidgetOrigin("http://127.0.0.1:5173", [], { allowDevOrigins: true }).allowed,
    true,
  );
  // A non-loopback origin is still blocked even with dev origins on.
  assert.equal(
    evaluateWidgetOrigin("https://evil.example", ACME, { allowDevOrigins: true }).allowed,
    false,
  );
});

test("localhost explicitly in the allowlist is allowed without the dev flag", () => {
  assert.equal(
    evaluateWidgetOrigin("http://localhost:5173", ["http://localhost:5173"]).allowed,
    true,
  );
});

test("isLocalhostOrigin", () => {
  assert.equal(isLocalhostOrigin("http://localhost:3000"), true);
  assert.equal(isLocalhostOrigin("http://127.0.0.1"), true);
  assert.equal(isLocalhostOrigin("https://acme.com"), false);
});

test("widgetOriginCandidate: discards our own app origin, prefers Origin then Referer then declared", () => {
  const appOrigin = "https://app.leadflow.example";
  // Origin header is our iframe → fall through to the declared parent origin.
  assert.equal(
    widgetOriginCandidate({
      originHeader: "https://app.leadflow.example",
      refererHeader: "https://app.leadflow.example/embed/abc",
      declared: "https://www.acme.com",
      appOrigin,
    }),
    "https://www.acme.com",
  );
  // A genuine cross-origin Origin header wins.
  assert.equal(
    widgetOriginCandidate({
      originHeader: "https://www.acme.com",
      refererHeader: null,
      declared: "https://spoof.example",
      appOrigin,
    }),
    "https://www.acme.com",
  );
  // Nothing usable → null (→ "missing" downstream).
  assert.equal(
    widgetOriginCandidate({
      originHeader: "https://app.leadflow.example",
      refererHeader: null,
      declared: null,
      appOrigin,
    }),
    null,
  );
  // Referer used when Origin absent.
  assert.equal(
    widgetOriginCandidate({
      originHeader: null,
      refererHeader: "https://www.acme.com/page",
      declared: null,
      appOrigin,
    }),
    "https://www.acme.com/page",
  );
});

test("end-to-end: declared parent origin from the widget script is matched against the allowlist", () => {
  const candidate = widgetOriginCandidate({
    originHeader: "https://app.leadflow.example",
    refererHeader: "https://app.leadflow.example/embed/k",
    declared: "https://shop.acme.com",
    appOrigin: "https://app.leadflow.example",
  });
  assert.equal(evaluateWidgetOrigin(candidate, ["https://shop.acme.com"]).allowed, true);
  assert.equal(evaluateWidgetOrigin(candidate, ["https://other.acme.com"]).allowed, false);
});
