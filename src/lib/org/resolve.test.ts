import { test } from "node:test";
import assert from "node:assert/strict";
import { demoChatEnabled } from "./resolve.ts";

test("demo chat is OFF by default", () => {
  assert.equal(demoChatEnabled({}), false);
  assert.equal(demoChatEnabled({ NODE_ENV: "development" }), false);
});

test("demo chat requires the explicit dev opt-in", () => {
  assert.equal(demoChatEnabled({ NODE_ENV: "development", LEADFLOW_ENABLE_DEMO_CHAT: "1" }), true);
  assert.equal(demoChatEnabled({ NODE_ENV: "test", LEADFLOW_ENABLE_DEMO_CHAT: "1" }), true);
  assert.equal(demoChatEnabled({ LEADFLOW_ENABLE_DEMO_CHAT: "true" }), false, "only '1' counts");
});

test("production NEVER enables demo chat from the plain opt-in", () => {
  assert.equal(
    demoChatEnabled({ NODE_ENV: "production", LEADFLOW_ENABLE_DEMO_CHAT: "1" }),
    false,
    "production must fail closed — no anonymous lead into a demo tenant",
  );
});

test("production demo chat needs a second, deliberate override", () => {
  assert.equal(
    demoChatEnabled({
      NODE_ENV: "production",
      LEADFLOW_ENABLE_DEMO_CHAT: "1",
      LEADFLOW_FORCE_DEMO_CHAT: "1",
    }),
    true,
  );
  // The force flag alone does nothing without the base opt-in.
  assert.equal(
    demoChatEnabled({ NODE_ENV: "production", LEADFLOW_FORCE_DEMO_CHAT: "1" }),
    false,
  );
});
