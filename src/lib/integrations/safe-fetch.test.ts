import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { assertPublicDestination, pinnedPost } from "./safe-fetch.ts";

const pub = (address: string, family = 4) => async () => [{ address, family }];

test("rejects a URL that fails the literal check without resolving", async () => {
  let resolved = false;
  const r = await assertPublicDestination("https://169.254.169.254/x", {
    lookupAll: async () => {
      resolved = true;
      return [{ address: "8.8.8.8", family: 4 }];
    },
  });
  assert.equal(r.ok, false);
  assert.equal(resolved, false, "a blocked literal is rejected before DNS");
});

test("DNS rebinding: a 'public' hostname that resolves to a private IP is rejected", async () => {
  const r = await assertPublicDestination("https://rebind.attacker.test/hook", {
    lookupAll: pub("127.0.0.1"),
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "integrationHub.validation.urlResolvesPrivate");
});

test("DNS rebinding: rejected if ANY resolved address is private (multi-record)", async () => {
  const r = await assertPublicDestination("https://mixed.attacker.test/hook", {
    lookupAll: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 }, // one poisoned record is enough
    ],
  });
  assert.equal(r.ok, false);
});

test("DNS rebinding: cloud metadata via a resolved IPv4-mapped IPv6 is rejected", async () => {
  const r = await assertPublicDestination("https://meta.attacker.test/latest", {
    lookupAll: async () => [{ address: "::ffff:169.254.169.254", family: 6 }],
  });
  assert.equal(r.ok, false);
});

test("a genuinely public hostname resolves and is pinned to its addresses", async () => {
  const r = await assertPublicDestination("https://hooks.zapier.com/x", {
    lookupAll: async () => [
      { address: "3.211.1.1", family: 4 },
      { address: "2600:1f18::1", family: 6 },
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.addresses, ["3.211.1.1", "2600:1f18::1"]);
});

test("an unresolvable host fails closed", async () => {
  const r = await assertPublicDestination("https://nope.invalid/x", {
    lookupAll: async () => {
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "integrationHub.validation.urlUnresolvable");
});

test("an empty DNS answer fails closed", async () => {
  const r = await assertPublicDestination("https://void.test/x", { lookupAll: async () => [] });
  assert.equal(r.ok, false);
});

test("a literal IP host skips DNS and is judged directly", async () => {
  let called = false;
  const ok = await assertPublicDestination("https://8.8.8.8/x", {
    lookupAll: async () => {
      called = true;
      return [];
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(called, false);

  const bad = await assertPublicDestination("https://127.0.0.1/x", {
    lookupAll: async () => {
      called = true;
      return [];
    },
  });
  assert.equal(bad.ok, false);
  assert.equal(called, false);
});

test("the INTEGRATION_ALLOW_INSECURE_URLS escape hatch still applies to resolved IPs", async () => {
  const r = await assertPublicDestination("http://lan-consumer.test/hook", {
    lookupAll: pub("192.168.1.50"),
    allowInsecure: true,
  });
  assert.equal(r.ok, true);
});

// ── pinnedPost: the real Node `lookup` hook, not a mocked one ──────────────
//
// Every other test here (and every `delivery.test.ts` case) uses an IP
// LITERAL as the destination URL — Node's http client skips the `lookup`
// hook entirely for a literal, so none of them ever exercised this function
// against a real hostname. That's exactly how a real bug (Node's Happy-
// Eyeballs `{ all: true }` lookup contract not being handled — see
// safe-fetch.ts's comment) went unnoticed: it broke every hostname-based
// webhook delivery, not just `localhost`, while every literal-IP test and
// the load-test harness's own `127.0.0.1`-only webhook mock (see
// loadtest/README.md) accidentally sailed past it.

let server: Server;
let port: number;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`echo:${body}`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("pinnedPost: a real hostname (not a literal) that resolves to multiple addresses still delivers", async () => {
  // `assertPublicDestination` against a real hostname resolving to BOTH
  // families, exactly like a real `localhost` DNS answer.
  const dest = await assertPublicDestination(`http://it-multi-addr.test:${port}/x`, {
    lookupAll: async () => [
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ],
    allowInsecure: true,
  });
  assert.equal(dest.ok, true);
  if (!dest.ok) return;

  const res = await pinnedPost(dest.url, dest.addresses, {
    headers: { "content-type": "text/plain" },
    body: "hello",
    timeoutMs: 2000,
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "echo:hello");
});

test("pinnedPost: a real hostname resolving to exactly one address still delivers", async () => {
  const dest = await assertPublicDestination(`http://it-single-addr.test:${port}/x`, {
    lookupAll: async () => [{ address: "127.0.0.1", family: 4 }],
    allowInsecure: true,
  });
  assert.equal(dest.ok, true);
  if (!dest.ok) return;

  const res = await pinnedPost(dest.url, dest.addresses, {
    headers: {},
    body: "ok",
    timeoutMs: 2000,
  });
  assert.equal(res.status, 200);
});

test("pinnedPost: an empty pre-validated address set is rejected immediately, never falls back to real DNS", async () => {
  const dest = await assertPublicDestination(`http://it-pinned.test:${port}/x`, {
    lookupAll: async () => [{ address: "127.0.0.1", family: 4 }],
    allowInsecure: true,
  });
  assert.equal(dest.ok, true);
  if (!dest.ok) return;

  // No addresses were pre-validated for this call — pinnedPost must refuse
  // outright rather than resolving the hostname itself.
  await assert.rejects(() =>
    pinnedPost(dest.url, [], { headers: {}, body: "x", timeoutMs: 1000 }),
  );
});
