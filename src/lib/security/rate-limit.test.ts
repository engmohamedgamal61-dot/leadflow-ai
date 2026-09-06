import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "./client-ip.ts";
import { chatIpRule, chatOrgRule } from "./rate-limit.ts";

function headers(map: Record<string, string>) {
  return { get: (n: string) => map[n.toLowerCase()] ?? null };
}

test("clientIp: first x-forwarded-for hop wins, then x-real-ip, then 'unknown'", () => {
  assert.equal(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIp(headers({ "x-real-ip": "198.51.100.9" })), "198.51.100.9");
  assert.equal(clientIp(headers({})), "unknown");
  assert.equal(clientIp(headers({ "x-forwarded-for": "  " })), "unknown");
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
