import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeWebhookUrl, validateEndpointInput } from "./validation.ts";

test("isSafeWebhookUrl accepts a normal https URL", () => {
  const r = isSafeWebhookUrl("https://n8n.example.com/webhook/abc");
  assert.equal(r.ok, true);
});

test("isSafeWebhookUrl rejects http, private, loopback and metadata hosts", () => {
  for (const url of [
    "http://n8n.example.com/hook",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://10.1.2.3/hook",
    "https://192.168.0.10/hook",
    "https://172.16.9.9/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/x",
    "https://box.local/hook",
    "https://[::1]/hook",
    "not-a-url",
  ]) {
    const r = isSafeWebhookUrl(url);
    assert.equal(r.ok, false, `should reject ${url}`);
  }
});

test("isSafeWebhookUrl allows insecure/private when the escape hatch is on", () => {
  assert.equal(
    isSafeWebhookUrl("http://192.168.1.5:5678/hook", { allowInsecure: true }).ok,
    true,
  );
});

test("isSafeWebhookUrl blocks obfuscated IP encodings (SSRF bypass attempts)", () => {
  for (const url of [
    "https://2130706433/x", // 127.0.0.1 as a 32-bit int
    "https://0x7f000001/x", // 127.0.0.1 as hex
    "https://0177.0.0.1/x", // 127.0.0.1 with an octal first octet
    "https://127.1/x", // short form
    "https://[::ffff:169.254.169.254]/latest/meta-data", // IPv4-mapped IPv6 → cloud metadata
    "https://[::ffff:7f00:1]/x", // IPv4-mapped IPv6, hex form
    "https://[::1]/x",
    "https://2852039166/x", // 169.254.169.254 as an int
    "https://0xA9FEA9FE/x", // 169.254.169.254 as hex
    "https://100.64.1.1/x", // carrier-grade NAT
    "https://user:pass@example.com/x", // embedded credentials
    "https://internal-service/x", // single-label host
  ]) {
    assert.equal(isSafeWebhookUrl(url).ok, false, `should reject ${url}`);
  }
});

test("isSafeWebhookUrl still accepts legitimate public FQDNs", () => {
  for (const url of [
    "https://hooks.zapier.com/hooks/catch/123/abc",
    "https://n8n.acme.co.uk/webhook/xyz",
    "https://8.8.8.8/collector", // a real public IP is fine
  ]) {
    assert.equal(isSafeWebhookUrl(url).ok, true, `should accept ${url}`);
  }
});

test("validateEndpointInput: happy path normalises + de-dupes events", () => {
  const v = validateEndpointInput({
    name: "  n8n  ",
    url: "https://n8n.example.com/webhook",
    events: ["lead.created", "lead.created", "bogus", "recovery.resolved"],
    description: "",
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.clean.events, ["lead.created", "recovery.resolved"]);
  assert.equal(v.clean.name, "n8n");
});

test("validateEndpointInput: reports each problem as a dictionary code", () => {
  const v = validateEndpointInput({
    name: "",
    url: "http://localhost/hook",
    events: [],
    description: "x".repeat(400),
  });
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("integrationHub.validation.nameLength"));
  assert.ok(v.errors.includes("integrationHub.validation.urlNotHttps"));
  assert.ok(v.errors.includes("integrationHub.validation.eventsRequired"));
  assert.ok(v.errors.includes("integrationHub.validation.descriptionLength"));
});

test("validateEndpointInput accepts a comma-separated events string", () => {
  const v = validateEndpointInput({
    name: "hook",
    url: "https://a.example.com",
    events: "lead.created, appointment.booked",
    description: "",
  });
  assert.deepEqual(v.clean.events, ["lead.created", "appointment.booked"]);
});
