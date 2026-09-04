import { test } from "node:test";
import assert from "node:assert/strict";
import { uuidFromProviderId } from "./ids.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("deterministic: same wamid → same UUID", () => {
  const a = uuidFromProviderId("wamid.HBgLMTY1MDM4Nzk0MzkVAgAS");
  const b = uuidFromProviderId("wamid.HBgLMTY1MDM4Nzk0MzkVAgAS");
  assert.equal(a, b);
  assert.match(a, UUID_RE);
});

test("different wamids → different UUIDs", () => {
  assert.notEqual(uuidFromProviderId("wamid.A"), uuidFromProviderId("wamid.B"));
});

test("output is a valid v5 UUID (matches the chat request_id column format)", () => {
  assert.match(uuidFromProviderId("anything"), UUID_RE);
});
