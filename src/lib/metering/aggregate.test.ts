import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateUsage, type UsageEvent } from "./aggregate.ts";

const NOW = new Date("2026-09-08T09:00:00Z"); // 12:00 Riyadh, Sept 8

function ev(over: Partial<UsageEvent>): UsageEvent {
  return {
    requestType: "chat_reply",
    model: "claude-sonnet-5",
    channel: "web",
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    estimatedCostUsd: 0.004,
    conversationId: "conv-1",
    leadId: "lead-1",
    occurredAt: "2026-09-08T08:00:00Z",
    ...over,
  };
}

test("currentMonth totals sum tokens, requests and cost", () => {
  const events = [
    ev({ inputTokens: 1000, outputTokens: 100, estimatedCostUsd: 0.003 }),
    ev({ inputTokens: 2000, outputTokens: 300, estimatedCostUsd: 0.008 }),
  ];
  const a = aggregateUsage(events, [], NOW);
  assert.equal(a.currentMonth.totalRequests, 2);
  assert.equal(a.currentMonth.inputTokens, 3000);
  assert.equal(a.currentMonth.outputTokens, 400);
  assert.equal(a.currentMonth.totalTokens, 3400);
  assert.equal(a.currentMonth.totalCostUsd, 0.011);
});

test("average cost per conversation and per lead use distinct ids", () => {
  const events = [
    ev({ conversationId: "c1", leadId: "l1", estimatedCostUsd: 0.01 }),
    ev({ conversationId: "c1", leadId: "l1", estimatedCostUsd: 0.01 }),
    ev({ conversationId: "c2", leadId: "l2", estimatedCostUsd: 0.02 }),
  ];
  const a = aggregateUsage(events, [], NOW);
  assert.equal(a.currentMonth.distinctConversations, 2);
  assert.equal(a.currentMonth.distinctLeads, 2);
  assert.equal(a.currentMonth.totalCostUsd, 0.04);
  assert.equal(a.currentMonth.avgCostPerConversation, 0.02);
  assert.equal(a.currentMonth.avgCostPerLead, 0.02);
});

test("null conversation/lead ids are not counted", () => {
  const a = aggregateUsage(
    [ev({ conversationId: null, leadId: null, estimatedCostUsd: 0.01 })],
    [],
    NOW,
  );
  assert.equal(a.currentMonth.distinctConversations, 0);
  assert.equal(a.currentMonth.avgCostPerConversation, 0);
});

test("today totals are the subset of current-month rows dated today (Riyadh)", () => {
  const events = [
    ev({ occurredAt: "2026-09-08T08:00:00Z", estimatedCostUsd: 0.01 }), // today
    ev({ occurredAt: "2026-09-07T08:00:00Z", estimatedCostUsd: 0.02 }), // yesterday
    ev({ occurredAt: "2026-09-08T21:30:00Z", estimatedCostUsd: 0.05 }), // Sept 9 Riyadh
  ];
  const a = aggregateUsage(events, [], NOW);
  assert.equal(a.today.totalRequests, 1);
  assert.equal(a.today.totalCostUsd, 0.01);
});

test("by-model breakdown groups and sorts by cost desc", () => {
  const events = [
    ev({ model: "claude-sonnet-5", estimatedCostUsd: 0.002 }),
    ev({ model: "claude-opus-5", estimatedCostUsd: 0.05 }),
    ev({ model: "claude-sonnet-5", estimatedCostUsd: 0.003 }),
  ];
  const a = aggregateUsage(events, [], NOW);
  assert.equal(a.byModel[0].model, "claude-opus-5");
  assert.equal(a.byModel[0].requests, 1);
  assert.equal(a.byModel[1].model, "claude-sonnet-5");
  assert.equal(a.byModel[1].requests, 2);
  assert.equal(a.byModel[1].costUsd, 0.005);
});

test("by-request-type separates reply and extraction, unknowns become 'other'", () => {
  const events = [
    ev({ requestType: "chat_reply", estimatedCostUsd: 0.004 }),
    ev({ requestType: "lead_extraction", estimatedCostUsd: 0.002 }),
    ev({ requestType: "legacy_thing", estimatedCostUsd: 0.001 }),
  ];
  const a = aggregateUsage(events, [], NOW);
  const byType = Object.fromEntries(a.byRequestType.map((r) => [r.requestType, r]));
  assert.equal(byType.chat_reply.costUsd, 0.004);
  assert.equal(byType.lead_extraction.costUsd, 0.002);
  assert.equal(byType.other.costUsd, 0.001);
});

test("daily trend is zero-filled for every day of the month and bucketed by Riyadh date", () => {
  const events = [
    ev({ occurredAt: "2026-09-01T08:00:00Z", estimatedCostUsd: 0.01 }),
    ev({ occurredAt: "2026-09-08T08:00:00Z", estimatedCostUsd: 0.02 }),
    ev({ occurredAt: "2026-09-08T10:00:00Z", estimatedCostUsd: 0.03 }),
  ];
  const a = aggregateUsage(events, [], NOW);
  assert.equal(a.daily.length, 30);
  const sept1 = a.daily.find((d) => d.date === "2026-09-01");
  const sept8 = a.daily.find((d) => d.date === "2026-09-08");
  const sept2 = a.daily.find((d) => d.date === "2026-09-02");
  assert.equal(sept1?.costUsd, 0.01);
  assert.equal(sept8?.requests, 2);
  assert.equal(sept8?.costUsd, 0.05);
  assert.equal(sept2?.costUsd, 0);
});

test("previousMonth totals come from the second argument", () => {
  const a = aggregateUsage(
    [],
    [ev({ estimatedCostUsd: 1.23, occurredAt: "2026-08-15T08:00:00Z" })],
    NOW,
  );
  assert.equal(a.previousMonth.totalRequests, 1);
  assert.equal(a.previousMonth.totalCostUsd, 1.23);
  assert.equal(a.currentMonth.totalRequests, 0);
});

test("empty input yields all-zero totals and no NaN", () => {
  const a = aggregateUsage([], [], NOW);
  assert.equal(a.currentMonth.totalCostUsd, 0);
  assert.equal(a.currentMonth.avgCostPerLead, 0);
  assert.equal(a.byModel.length, 0);
  assert.equal(a.daily.every((d) => d.costUsd === 0), true);
});
