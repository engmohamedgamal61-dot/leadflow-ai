import { test } from "node:test";
import assert from "node:assert/strict";
import { logEvent } from "./log.ts";

function captureConsoleLog(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = console.log;
  console.log = (line: unknown) => {
    calls.push(String(line));
  };
  return {
    calls,
    restore: () => {
      console.log = original;
    },
  };
}

test("logEvent writes one structured JSON line with the given fields", () => {
  const cap = captureConsoleLog();
  try {
    logEvent({
      event: "anthropic.chat_reply",
      requestId: "req-123",
      organizationId: "org-456",
      durationMs: 842,
      channel: "web",
    });
  } finally {
    cap.restore();
  }
  assert.equal(cap.calls.length, 1);
  const parsed = JSON.parse(cap.calls[0]);
  assert.equal(parsed.level, "info");
  assert.equal(parsed.event, "anthropic.chat_reply");
  assert.equal(parsed.requestId, "req-123");
  assert.equal(parsed.organizationId, "org-456");
  assert.equal(parsed.durationMs, 842);
  assert.equal(parsed.channel, "web");
  assert.equal(typeof parsed.at, "string");
});

test("logEvent redacts anything that looks like a secret in a string field", () => {
  const cap = captureConsoleLog();
  try {
    logEvent({
      event: "calendar.google.insertEvent",
      detail: "Authorization: Bearer abcd1234efgh5678",
    });
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.calls[0]);
  assert.equal(parsed.detail, "Authorization: Bearer [redacted]");
});

test("logEvent never includes message content or PII fields the caller didn't pass", () => {
  const cap = captureConsoleLog();
  try {
    logEvent({ event: "db.persist.chat_turn", requestId: null, organizationId: "org-1", durationMs: 12 });
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.calls[0]);
  assert.equal(Object.hasOwn(parsed, "message"), false);
  assert.equal(Object.hasOwn(parsed, "content"), false);
  assert.equal(parsed.requestId, null);
});

test("logEvent omits undefined fields entirely rather than writing them as null", () => {
  const cap = captureConsoleLog();
  try {
    logEvent({ event: "x", durationMs: undefined });
  } finally {
    cap.restore();
  }
  const parsed = JSON.parse(cap.calls[0]);
  assert.equal(Object.hasOwn(parsed, "durationMs"), false);
});

test("logEvent never throws even if console.log itself throws", () => {
  const original = console.log;
  console.log = () => {
    throw new Error("stdout closed");
  };
  try {
    assert.doesNotThrow(() => logEvent({ event: "x" }));
  } finally {
    console.log = original;
  }
});
