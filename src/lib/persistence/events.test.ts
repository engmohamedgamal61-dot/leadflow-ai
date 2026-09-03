import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLeadEvents } from "./events.ts";

const snap = (score: number, temperature: string, status = "new") => ({
  score,
  temperature,
  status,
});

test("a new lead emits lead_created + message_received only", () => {
  const events = computeLeadEvents({
    isNewLead: true,
    previous: null,
    next: snap(35, "cold"),
    userMessage: "I want a villa in Riyadh",
  });
  assert.deepEqual(
    events.map((e) => e.event_type),
    ["lead_created", "message_received"],
  );
  assert.deepEqual(events[0].metadata, { score: 35, temperature: "cold" });
  assert.equal(events[1].metadata.role, "user");
  assert.equal(events[1].metadata.length, "I want a villa in Riyadh".length);
});

test("no score/temperature change emits no change events", () => {
  const events = computeLeadEvents({
    isNewLead: false,
    previous: snap(80, "hot"),
    next: snap(80, "hot"),
    userMessage: "thanks",
  });
  assert.deepEqual(
    events.map((e) => e.event_type),
    ["message_received"],
  );
});

test("score_changed carries from/new values", () => {
  const events = computeLeadEvents({
    isNewLead: false,
    previous: snap(55, "warm"),
    next: snap(80, "hot"),
    userMessage: "financing yes",
  });
  const score = events.find((e) => e.event_type === "score_changed");
  const temp = events.find((e) => e.event_type === "temperature_changed");
  assert.deepEqual(score?.metadata, { from: 55, to: 80 });
  assert.deepEqual(temp?.metadata, { from: "warm", to: "hot" });
});

test("status_changed carries from/new values", () => {
  const events = computeLeadEvents({
    isNewLead: false,
    previous: snap(80, "hot", "new"),
    next: snap(80, "hot", "qualified"),
    userMessage: "next",
  });
  const status = events.find((e) => e.event_type === "status_changed");
  assert.deepEqual(status?.metadata, { from: "new", to: "qualified" });
});

test("message preview is bounded", () => {
  const long = "x".repeat(1000);
  const events = computeLeadEvents({
    isNewLead: true,
    previous: null,
    next: snap(0, "cold"),
    userMessage: long,
  });
  const received = events.find((e) => e.event_type === "message_received");
  assert.ok((received?.metadata.preview as string).length <= 160);
});
