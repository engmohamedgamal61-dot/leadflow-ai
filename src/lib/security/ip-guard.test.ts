import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isBlockedIp,
  isBlockedIpv4,
  isBlockedIpv6,
  parseIpv4,
} from "./ip-guard.ts";

test("parseIpv4 canonicalises every spelling", () => {
  assert.deepEqual(parseIpv4("127.0.0.1"), [127, 0, 0, 1]);
  assert.deepEqual(parseIpv4("2130706433"), [127, 0, 0, 1]); // 32-bit int
  assert.deepEqual(parseIpv4("0x7f000001"), [127, 0, 0, 1]); // hex
  assert.deepEqual(parseIpv4("0177.0.0.1"), [127, 0, 0, 1]); // octal octet
  assert.deepEqual(parseIpv4("127.1"), [127, 0, 0, 1]); // short form
  assert.deepEqual(parseIpv4("169.254.169.254"), [169, 254, 169, 254]);
  assert.equal(parseIpv4("example.com"), null);
  assert.equal(parseIpv4("999.1.1.1"), null);
});

test("isBlockedIpv4: loopback / private / CGNAT / metadata / reserved", () => {
  for (const ip of [
    "0.0.0.0", "127.0.0.1", "10.1.2.3", "172.16.9.9", "172.31.255.255",
    "192.168.0.1", "169.254.169.254", "100.64.0.1", "100.127.255.255",
    "192.0.2.5", "198.18.5.5", "224.0.0.1", "240.1.2.3", "255.255.255.255",
  ]) {
    assert.equal(isBlockedIpv4(parseIpv4(ip)!), true, `${ip} should be blocked`);
  }
});

test("isBlockedIpv4: real public addresses pass", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1"]) {
    assert.equal(isBlockedIpv4(parseIpv4(ip)!), false, `${ip} should pass`);
  }
});

test("isBlockedIpv6: loopback / ULA / link-local / mapped / documentation", () => {
  for (const ip of [
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1",
    "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:169.254.169.254", "[::ffff:10.0.0.1]",
    "::ffff:7f00:1", // ::ffff:127.0.0.1 in hex
    "64:ff9b::7f00:1", // NAT64 of a loopback v4
  ]) {
    assert.equal(isBlockedIpv6(ip), true, `${ip} should be blocked`);
  }
});

test("isBlockedIpv6: a real public v6 passes", () => {
  assert.equal(isBlockedIpv6("2606:4700:4700::1111"), false); // Cloudflare
  assert.equal(isBlockedIpv6("2a00:1450:4009:81f::200e"), false); // Google
});

test("isBlockedIp dispatches on address form; garbage is blocked", () => {
  assert.equal(isBlockedIp("127.0.0.1"), true);
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("::ffff:169.254.169.254"), true);
  assert.equal(isBlockedIp("2606:4700:4700::1111"), false);
  assert.equal(isBlockedIp("not-an-ip"), true);
  assert.equal(isBlockedIp(""), true);
  assert.equal(isBlockedIp("169.254.169.254%eth0"), true); // zone id stripped
});
