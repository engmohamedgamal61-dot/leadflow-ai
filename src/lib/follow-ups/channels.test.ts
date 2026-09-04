import { test } from "node:test";
import assert from "node:assert/strict";
import {
  internalAdapter,
  resolveAdapter,
  type FollowUpChannelAdapter,
} from "./channels.ts";

const ctx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: {} as any,
  organizationId: "org",
  leadId: "lead",
  conversationId: null,
  channel: "internal",
  message: "Hi there, checking in.",
  isDemo: false,
};

test("the internal adapter succeeds and never marks retryable", async () => {
  const r = await internalAdapter.deliver(ctx);
  assert.deepEqual(r, { ok: true, retryable: false });
});

test("resolveAdapter returns the internal adapter for a known channel", () => {
  assert.equal(resolveAdapter("internal").name, "internal");
});

test("an unknown / future channel falls back to internal (no external send)", () => {
  assert.equal(resolveAdapter("whatsapp").name, "internal");
  assert.equal(resolveAdapter("email").name, "internal");
});

test("a custom registry can be injected (test seam)", () => {
  const fake: FollowUpChannelAdapter = {
    name: "fake",
    deliver: async () => ({ ok: false, retryable: true, detail: "boom" }),
  };
  const reg = { internal: fake };
  assert.equal(resolveAdapter("internal", reg).name, "fake");
});
