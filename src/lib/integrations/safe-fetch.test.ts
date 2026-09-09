import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicDestination } from "./safe-fetch.ts";

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
