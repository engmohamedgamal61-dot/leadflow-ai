import { test } from "node:test";
import assert from "node:assert/strict";
import { runAsk, type AskDeps } from "./orchestration.ts";
import type { IntentResult } from "./ranking.ts";
import type { AskIntent } from "./intents.ts";

const nonEmpty: IntentResult = {
  intent: "priority_leads",
  metrics: [{ key: "needsAttention", value: 2 }],
  leads: [
    {
      id: "l1",
      name: "Nadia",
      status: "qualified",
      temperature: "hot",
      score: 70,
      reasonKey: "insights.reasons.unansweredInbound",
      tag: "reply_now",
      href: "/dashboard/leads/l1",
    },
  ],
  appointments: [],
  activity: [],
  empty: false,
};

const emptyResult: IntentResult = {
  intent: "priority_leads",
  metrics: [],
  leads: [],
  appointments: [],
  activity: [],
  empty: true,
};

function makeDeps(over: Partial<AskDeps> & { result?: IntentResult } = {}): {
  deps: AskDeps;
  calls: {
    runIntent: AskIntent[];
    checkGate: number;
    generateAnswer: string[];
    recordUsage: { model: string; requestId: string }[];
  };
} {
  const calls = {
    runIntent: [] as AskIntent[],
    checkGate: 0,
    generateAnswer: [] as string[],
    recordUsage: [] as { model: string; requestId: string }[],
  };
  const deps: AskDeps = {
    locale: "en",
    reason: (k) => k,
    metricLabel: (k) => k,
    now: new Date("2026-09-08T09:00:00Z"),
    requestId: "req-1",
    runIntent: async (intent) => {
      calls.runIntent.push(intent);
      return over.result ?? nonEmpty;
    },
    checkGate: async () => {
      calls.checkGate += 1;
      return { allowed: true };
    },
    generateAnswer: async (ctx) => {
      calls.generateAnswer.push(ctx);
      return { text: "Nadia needs a reply.", usage: { inputTokens: 800, outputTokens: 40 }, model: "claude-sonnet-5" };
    },
    recordUsage: async ({ model, requestId }) => {
      calls.recordUsage.push({ model, requestId });
    },
    ...over,
  };
  return { deps, calls };
}

test("routes the question to the matching allowlisted intent", async () => {
  const { deps, calls } = makeDeps();
  await runAsk("which leads are at risk?", deps);
  assert.deepEqual(calls.runIntent, ["at_risk_leads"]);
});

test("no data → deterministic answer, NO gate check, NO Anthropic call, NO metering", async () => {
  const { deps, calls } = makeDeps({ result: emptyResult });
  const res = await runAsk("who needs attention?", deps);
  assert.equal(res.state, "no_data");
  assert.equal(res.answer, null);
  assert.equal(res.answerKey, "askLeadFlow.noData.needsAttention");
  assert.equal(res.aiUsed, false);
  assert.equal(calls.checkGate, 0);
  assert.equal(calls.generateAnswer.length, 0);
  assert.equal(calls.recordUsage.length, 0);
});

test("hard usage limit reached → deterministic answer, NO Anthropic call, NO metering", async () => {
  const { deps, calls } = makeDeps({ checkGate: async () => ({ allowed: false }) });
  const res = await runAsk("who should we work first?", deps);
  assert.equal(res.state, "limit_reached");
  assert.equal(res.answerKey, "askLeadFlow.limitReached");
  assert.equal(res.aiUsed, false);
  assert.equal(calls.generateAnswer.length, 0);
  assert.equal(calls.recordUsage.length, 0);
  // the deterministic data is still returned for the UI
  assert.equal(res.result.leads.length, 1);
});

test("happy path → ONE grounded call, answer returned, usage recorded once", async () => {
  const { deps, calls } = makeDeps();
  const res = await runAsk("who should we work first?", deps);
  assert.equal(res.state, "answered");
  assert.equal(res.answer, "Nadia needs a reply.");
  assert.equal(res.answerKey, null);
  assert.equal(res.aiUsed, true);
  assert.equal(calls.checkGate, 1);
  assert.equal(calls.generateAnswer.length, 1);
  assert.ok(calls.generateAnswer[0].includes("Nadia"), "context is grounded in the real data");
  assert.deepEqual(calls.recordUsage, [{ model: "claude-sonnet-5", requestId: "req-1" }]);
});

test("model returns nothing usable → answer_unavailable, no metering, data still shown", async () => {
  const { deps, calls } = makeDeps({
    generateAnswer: async () => ({ text: "", usage: null, model: "claude-sonnet-5" }),
  });
  const res = await runAsk("who should we work first?", deps);
  assert.equal(res.state, "answer_unavailable");
  assert.equal(res.answerKey, "askLeadFlow.answerUnavailable");
  assert.equal(res.aiUsed, false);
  assert.equal(calls.recordUsage.length, 0);
  assert.equal(res.result.leads.length, 1);
});

test("a generated answer with no usage object is still returned, without a metering write", async () => {
  const { deps, calls } = makeDeps({
    generateAnswer: async () => ({ text: "Here you go.", usage: null, model: "claude-sonnet-5" }),
  });
  const res = await runAsk("pipeline overview", deps);
  assert.equal(res.state, "answered");
  assert.equal(res.answer, "Here you go.");
  assert.equal(calls.recordUsage.length, 0);
});
