import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "./route.ts";

test("liveness: always 200, fixed shape, no dependency check", async () => {
  const res = GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(typeof body.time, "string");
  // Nothing beyond the documented shape — no ids, counts, or schema.
  assert.deepEqual(Object.keys(body).sort(), ["status", "time"]);
});

test("liveness: never cached by an intermediary", async () => {
  const res = GET();
  assert.equal(res.headers.get("cache-control"), "no-store");
});
