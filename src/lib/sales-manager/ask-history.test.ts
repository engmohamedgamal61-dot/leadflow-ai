import { test } from "node:test";
import assert from "node:assert/strict";
import { toPlannerHistory, type AnsweredTurn } from "./ask-history.ts";

/** A translator that actually interpolates {name} params, like the real i18n one. */
const t = (key: string, params?: Record<string, string | number>): string => {
  const templates: Record<string, string> = {
    "askLeadFlow.deterministic.totalLeads": "You have {count} leads.",
    "askLeadFlow.deterministic.appointmentCount": "You have {count} upcoming appointments.",
    "askLeadFlow.noData.generic": "Nothing to report for that.",
  };
  const tmpl = templates[key] ?? key;
  return tmpl.replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? `{${k}}`));
};

test("a prose answer is carried verbatim as the assistant turn", () => {
  const turns: AnsweredTurn[] = [
    { question: "who should I call?", result: { answer: "Call Nadia first — she replied yesterday.", answerKey: null, answerParams: null } },
  ];
  assert.deepEqual(toPlannerHistory(turns, t), [
    { role: "user", content: "who should I call?" },
    { role: "assistant", content: "Call Nadia first — she replied yesterday." },
  ]);
});

test("REGRESSION: a deterministic answer is rendered WITH its params — no {count} placeholder leaks into history", () => {
  const turns: AnsweredTurn[] = [
    {
      question: "كام عميل عندي؟",
      result: { answer: null, answerKey: "askLeadFlow.deterministic.totalLeads", answerParams: { count: 42 } },
    },
  ];
  const history = toPlannerHistory(turns, t);
  assert.deepEqual(history[1], { role: "assistant", content: "You have 42 leads." });
  assert.ok(!history[1].content.includes("{count}"), "no unrendered placeholder");
});

test("a deterministic answer with no params still renders (key → text)", () => {
  const turns: AnsweredTurn[] = [
    { question: "anything new?", result: { answer: null, answerKey: "askLeadFlow.noData.generic", answerParams: null } },
  ];
  assert.equal(toPlannerHistory(turns, t)[1].content, "Nothing to report for that.");
});

test("a turn with neither answer nor answerKey contributes only the user question", () => {
  const turns: AnsweredTurn[] = [
    { question: "hmm", result: { answer: null, answerKey: null, answerParams: null } },
  ];
  assert.deepEqual(toPlannerHistory(turns, t), [{ role: "user", content: "hmm" }]);
});

test("history is capped to the most recent N turns (default 6 messages)", () => {
  const turns: AnsweredTurn[] = Array.from({ length: 8 }, (_, i) => ({
    question: `q${i}`,
    result: { answer: `a${i}`, answerKey: null, answerParams: null },
  }));
  const history = toPlannerHistory(turns, t);
  assert.equal(history.length, 6);
  assert.equal(history[0].content, "q5", "oldest carried turn is q5 (8 turns → last 6 messages)");
  assert.equal(history.at(-1)?.content, "a7");
});
