import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCsp,
  frameAncestorsFor,
  generateNonce,
  NONCE_HEADER,
} from "./csp.ts";

test("generateNonce: base64, unpredictable, unique", () => {
  const a = generateNonce();
  const b = generateNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(Buffer.from(a, "base64").length >= 16);
});

test("production script-src is 'self' + nonce, no unsafe-inline / unsafe-eval / strict-dynamic", () => {
  const csp = buildCsp({
    nonce: "abc123",
    isDev: false,
    frameAncestors: "'none'",
    supabaseUrl: "https://proj.supabase.co",
  });
  const scriptSrc = csp.match(/script-src [^;]+/)![0];
  assert.ok(scriptSrc.includes("'self'"));
  assert.ok(scriptSrc.includes("'nonce-abc123'"));
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), "no unsafe-inline in prod script-src");
  assert.ok(!scriptSrc.includes("'unsafe-eval'"), "no unsafe-eval in prod script-src");
  assert.ok(
    !scriptSrc.includes("'strict-dynamic'"),
    "strict-dynamic breaks Next prefetch; 'self'+nonce is the compatible strict policy",
  );
});

test("dev script-src adds unsafe-eval only (React Refresh), still nonce'd, no unsafe-inline", () => {
  const csp = buildCsp({ nonce: "n", isDev: true, frameAncestors: "'none'" });
  const scriptSrc = csp.match(/script-src [^;]+/)![0];
  assert.ok(scriptSrc.includes("'nonce-n'"));
  assert.ok(scriptSrc.includes("'unsafe-eval'"));
  assert.ok(!scriptSrc.includes("'unsafe-inline'"));
});

test("connect-src is scoped to self + the Supabase project (http + wss)", () => {
  const csp = buildCsp({
    nonce: "n",
    isDev: false,
    frameAncestors: "'none'",
    supabaseUrl: "https://proj.supabase.co",
  });
  const connect = csp.match(/connect-src [^;]+/)![0];
  assert.ok(connect.includes("'self'"));
  assert.ok(connect.includes("https://proj.supabase.co"));
  assert.ok(connect.includes("wss://proj.supabase.co"));
  assert.ok(!connect.includes("*"), "no wildcard connect-src");
});

test("locked-down directives are present", () => {
  const csp = buildCsp({ nonce: "n", isDev: false, frameAncestors: "'none'" });
  for (const d of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ]) {
    assert.ok(csp.includes(d), `missing: ${d}`);
  }
});

test("frame-ancestors: DENY-equivalent for app routes, framed allowance for /embed", () => {
  assert.equal(frameAncestorsFor("/dashboard"), "'none'");
  assert.equal(frameAncestorsFor("/"), "'none'");
  assert.equal(frameAncestorsFor("/embedded"), "'none'"); // not the embed route
  assert.match(frameAncestorsFor("/embed/abc"), /^'self' https:/);
  assert.match(frameAncestorsFor("/embed"), /^'self' https:/);

  const embedCsp = buildCsp({
    nonce: "n",
    isDev: false,
    frameAncestors: frameAncestorsFor("/embed/xyz"),
  });
  assert.ok(embedCsp.includes("frame-ancestors 'self' https:"));
  assert.ok(!embedCsp.includes("frame-ancestors 'none'"));
});

test("NONCE_HEADER is the documented Next.js header name", () => {
  assert.equal(NONCE_HEADER, "x-nonce");
});
