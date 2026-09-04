import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildTextMessage,
  buildTemplateMessage,
  isRetryableMetaError,
  fetchMetaTransport,
} from "./meta-client.ts";

test("buildTextMessage produces a free-form text body", () => {
  const b = buildTextMessage("16505551234", "Hello there");
  assert.deepEqual(b, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "16505551234",
    type: "text",
    text: { preview_url: false, body: "Hello there" },
  });
});

test("buildTemplateMessage produces a template body with a language + empty components", () => {
  const b = buildTemplateMessage("16505551234", "lead_follow_up", "ar") as {
    type: string;
    template: { name: string; language: { code: string }; components: unknown[] };
  };
  assert.equal(b.type, "template");
  assert.equal(b.template.name, "lead_follow_up");
  assert.equal(b.template.language.code, "ar");
  assert.deepEqual(b.template.components, []);
});

test("isRetryableMetaError only flags rate-limit / transient codes", () => {
  assert.equal(isRetryableMetaError(80007), true);
  assert.equal(isRetryableMetaError(130429), true);
  assert.equal(isRetryableMetaError(503), true);
  assert.equal(isRetryableMetaError(190), false); // auth
  assert.equal(isRetryableMetaError(132000), false); // template
  assert.equal(isRetryableMetaError(undefined), false);
});

// ── fetchMetaTransport against a stubbed global.fetch ────────────────────

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("fetchMetaTransport: success returns the provider message id", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.OUT99" }] }), {
      status: 200,
    })) as typeof fetch;
  const r = await fetchMetaTransport.send({
    phoneNumberId: "PN",
    accessToken: "tok",
    body: buildTextMessage("1", "hi"),
  });
  assert.deepEqual(r, { ok: true, retryable: false, providerMessageId: "wamid.OUT99" });
});

test("fetchMetaTransport: a Meta 190 error is non-retryable", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { code: 190, message: "token expired" } }), {
      status: 401,
    })) as typeof fetch;
  const r = await fetchMetaTransport.send({ phoneNumberId: "PN", accessToken: "t", body: {} });
  assert.equal(r.ok, false);
  assert.equal(r.retryable, false);
  assert.equal(r.errorCode, 190);
});

test("fetchMetaTransport: a 500 / network error is retryable", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
  const a = await fetchMetaTransport.send({ phoneNumberId: "PN", accessToken: "t", body: {} });
  assert.equal(a.ok, false);
  assert.equal(a.retryable, true);

  globalThis.fetch = (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch;
  const b = await fetchMetaTransport.send({ phoneNumberId: "PN", accessToken: "t", body: {} });
  assert.equal(b.ok, false);
  assert.equal(b.retryable, true);
});

test("fetchMetaTransport never puts the token in the result", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { code: 100, message: "bad" } }), { status: 400 })) as typeof fetch;
  const r = await fetchMetaTransport.send({
    phoneNumberId: "PN",
    accessToken: "SUPER_SECRET_TOKEN",
    body: {},
  });
  assert.doesNotMatch(JSON.stringify(r), /SUPER_SECRET_TOKEN/);
});
