import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, type ClientIpConfig } from "./client-ip.ts";
import { chatIpRule, chatOrgRule, salesManagerRule } from "./rate-limit.ts";

function headers(map: Record<string, string>) {
  return { get: (n: string) => map[n.toLowerCase()] ?? null };
}

const oneHop: ClientIpConfig = { trustedHeader: null, trustedProxyHops: 1 };

test("clientIp: with 1 trusted proxy, the real client is the LAST x-forwarded-for entry", () => {
  // Proxy appends the connecting IP → last entry is trustworthy.
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "203.0.113.7" }), oneHop),
    "203.0.113.7",
  );
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), oneHop),
    "10.0.0.1",
  );
});

test("clientIp: a spoofed X-Forwarded-For prefix is IGNORED (attacker pushes it left)", () => {
  // Attacker sends `X-Forwarded-For: 1.2.3.4`; the proxy appends the real IP.
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "1.2.3.4, 66.66.66.66" }), oneHop),
    "66.66.66.66",
  );
  // Attacker sends a long fake chain; still only the trailing real hop counts.
  assert.equal(
    clientIp(
      headers({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 7.7.7.7, 66.66.66.66" }),
      oneHop,
    ),
    "66.66.66.66",
  );
});

test("clientIp: N trusted hops takes the Nth entry from the right", () => {
  const twoHops: ClientIpConfig = { trustedHeader: null, trustedProxyHops: 2 };
  // client, realAsSeenByLB1, lb1AsSeenByLB2
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "1.2.3.4, 66.66.66.66, 10.0.0.2" }), twoHops),
    "66.66.66.66",
  );
});

test("clientIp: a platform trusted-IP header wins over X-Forwarded-For", () => {
  const cfg: ClientIpConfig = { trustedHeader: "cf-connecting-ip", trustedProxyHops: 1 };
  assert.equal(
    clientIp(
      headers({
        "cf-connecting-ip": "66.66.66.66",
        "x-forwarded-for": "1.2.3.4, 2.3.4.5",
      }),
      cfg,
    ),
    "66.66.66.66",
  );
  // Header absent → falls back to the XFF strategy, not blind trust.
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "1.2.3.4, 66.66.66.66" }), cfg),
    "66.66.66.66",
  );
});

test("clientIp: garbage / IPv6 / fallbacks", () => {
  assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.9" }), oneHop), "198.51.100.9");
  assert.equal(clientIp(headers({}), oneHop), "unknown");
  assert.equal(clientIp(headers({ "x-forwarded-for": "  " }), oneHop), "unknown");
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "not-an-ip, also-bad" }), oneHop),
    "unknown",
  );
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "junk, 2001:db8::1" }), oneHop),
    "2001:db8::1",
  );
  // out-of-range octets are rejected
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "999.1.1.1, 8.8.8.8" }), oneHop),
    "8.8.8.8",
  );
});

test("rate rules: sensible defaults, env-overridable", () => {
  const ip = chatIpRule("1.2.3.4");
  assert.equal(ip.bucket, "chat:ip");
  assert.equal(ip.id, "1.2.3.4");
  assert.ok(ip.max > 0 && ip.windowSeconds > 0);

  const org = chatOrgRule("org-123");
  assert.equal(org.bucket, "chat:org");
  assert.equal(org.windowSeconds, 3600);

  process.env.CHAT_RATE_LIMIT_PER_IP = "5";
  assert.equal(chatIpRule("x").max, 5);
  delete process.env.CHAT_RATE_LIMIT_PER_IP;

  process.env.CHAT_RATE_LIMIT_PER_IP = "not-a-number";
  assert.equal(chatIpRule("x").max, 20, "falls back on junk");
  delete process.env.CHAT_RATE_LIMIT_PER_IP;
});

test("salesManagerRule: per-org, short window, env-overridable", () => {
  const r = salesManagerRule("org-abc");
  assert.equal(r.bucket, "ask:org");
  assert.equal(r.id, "org-abc");
  assert.equal(r.windowSeconds, 60);
  assert.ok(r.max > 0 && r.max <= 60);

  process.env.ASK_LEADFLOW_RATE_LIMIT_PER_MIN = "3";
  assert.equal(salesManagerRule("x").max, 3);
  delete process.env.ASK_LEADFLOW_RATE_LIMIT_PER_MIN;
  process.env.ASK_LEADFLOW_RATE_LIMIT_PER_MIN = "junk";
  assert.equal(salesManagerRule("x").max, 15, "falls back on junk");
  delete process.env.ASK_LEADFLOW_RATE_LIMIT_PER_MIN;
});
