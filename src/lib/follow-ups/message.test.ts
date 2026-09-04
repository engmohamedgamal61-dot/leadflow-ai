import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFollowUpMessage } from "./message.ts";

test("uses the note verbatim when present, with the lead's first name", () => {
  const msg = buildFollowUpMessage({
    note: "you asked me to call about the Jeddah villa",
    leadName: "Khaled Al-Otaibi",
  });
  assert.match(msg, /^Hi Khaled, /);
  assert.match(msg, /you asked me to call about the Jeddah villa/);
});

test("falls back to a generic check-in and 'there' when there is no name", () => {
  const msg = buildFollowUpMessage({ note: null, leadName: null });
  assert.match(msg, /^Hi there, /);
  assert.match(msg, /checking in/i);
});

test("is deterministic and length-capped", () => {
  const a = buildFollowUpMessage({ note: "x", leadName: "A" });
  const b = buildFollowUpMessage({ note: "x", leadName: "A" });
  assert.equal(a, b);
  const long = buildFollowUpMessage({ note: "z".repeat(5000), leadName: "A" });
  assert.ok(long.length <= 600);
});
