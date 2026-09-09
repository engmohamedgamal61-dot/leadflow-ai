import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGroundingContext,
  mergeViews,
  renderGroundingText,
  type ExecutedOperation,
} from "./grounding.ts";

const now = new Date("2026-09-09T12:00:00Z");

function op(over: Partial<ExecutedOperation>): ExecutedOperation {
  return {
    type: "lead_count",
    label: "no filters",
    data: { count: 0 },
    empty: false,
    accuracy: "exact",
    warnings: [],
    assumptions: [],
    view: { metrics: [], leads: [], appointments: [], activity: [] },
    ...over,
  };
}

test("buildGroundingContext keeps the question, a UTC now, and one entry per operation", () => {
  const ctx = buildGroundingContext(
    "how many leads and what changed?",
    [
      op({ type: "lead_count", label: "no filters", data: { count: 12 } }),
      op({ type: "compare_periods", label: "new leads: week vs week", data: { current: 4, previous: 9, change: -5 } }),
    ],
    now,
  );
  assert.equal(ctx.question, "how many leads and what changed?");
  assert.equal(ctx.now, "2026-09-09T12:00:00.000Z");
  assert.equal(ctx.results.length, 2);
  assert.equal(ctx.results[0].operation, "lead_count");
  assert.equal(ctx.results[1].data.change, -5);
  assert.equal(ctx.allEmpty, false);
  assert.equal(ctx.hasInexact, false);
});

test("data-quality metadata flows into the context and the reminder appears", () => {
  const ctx = buildGroundingContext(
    "hot leads that went quiet",
    [
      op({
        type: "lead_search",
        label: "opportunity=hot; lead record not updated for last 7 days (updated_at proxy)",
        accuracy: "proxy",
        warnings: ["'stale_for' matches leads whose LEAD RECORD has not been updated for that long. It is NOT evidence that no one contacted the lead."],
        assumptions: ["12 leads match; only the top 8 are shown."],
        data: { returned_count: 8, total_count: 12 },
      }),
    ],
    now,
  );
  assert.equal(ctx.results[0].accuracy, "proxy");
  assert.equal(ctx.hasInexact, true);
  const text = renderGroundingText(ctx);
  assert.ok(text.includes("accuracy: PROXY"));
  assert.ok(text.includes("WARNING: 'stale_for'"));
  assert.ok(text.includes("ASSUMPTION (disclose this): 12 leads match"));
  assert.ok(/REMINDER: at least one result above is PARTIAL or PROXY/.test(text));
});

test("proxy grounding text never asserts a contact/follow-up claim", () => {
  const text = renderGroundingText(
    buildGroundingContext(
      "leads no one contacted",
      [
        op({
          type: "lead_search",
          label: "lead record not updated for last 30 days (updated_at proxy)",
          accuracy: "proxy",
          warnings: [
            "'stale_for' matches leads whose LEAD RECORD has not been updated (updated_at) for that long. It is NOT evidence that no one contacted, called or messaged the lead — only that the record shows no recent change.",
          ],
          data: { returned_count: 3, total_count: 3 },
        }),
      ],
      now,
    ),
  );
  // the grounding text must frame it as a record signal, and must carry the caveat
  assert.ok(/not evidence that no one contacted/i.test(text));
  assert.ok(text.includes("updated_at"));
});

test("allEmpty is true only when every operation is empty", () => {
  assert.equal(
    buildGroundingContext("q", [op({ empty: true }), op({ empty: true })], now).allEmpty,
    true,
  );
  assert.equal(
    buildGroundingContext("q", [op({ empty: true }), op({ empty: false })], now).allEmpty,
    false,
  );
});

test("renderGroundingText is compact, labelled, and never contains an internal id", () => {
  const text = renderGroundingText(
    buildGroundingContext(
      "who should I call first?",
      [
        op({
          type: "lead_search",
          label: "sorted priority desc; limit 5",
          data: {
            matched_shown: 2,
            total_matching: 2,
            leads: [
              { name: "Nadia", status: "qualified", opportunity: "hot", score: 82, reason: "no reply for 3 hours" },
              { name: "(unnamed lead)", status: "contacted", opportunity: "warm", score: 40, reason: "on track" },
            ],
          },
        }),
      ],
      now,
    ),
  );
  assert.ok(text.includes("QUESTION: who should I call first?"));
  assert.ok(text.includes("NOW: 2026-09-09T12:00:00.000Z (UTC)"));
  assert.ok(text.includes("[1] lead_search — sorted priority desc; limit 5"));
  assert.ok(text.includes("Nadia"));
  assert.ok(text.includes("no reply for 3 hours"));
  assert.ok(!/lead-\w+|[0-9a-f]{8}-[0-9a-f]{4}/i.test(text), "no raw ids in the grounding text");
});

test("mergeViews concatenates metrics, dedupes leads/appointments by id, caps the result", () => {
  const merged = mergeViews([
    op({
      view: {
        metrics: [{ key: "totalLeads", value: 12 }],
        leads: [
          { id: "a", name: "A", status: "new", temperature: "hot", score: 1, reasonKey: null, tag: null, href: "/x" },
          { id: "b", name: "B", status: "new", temperature: "hot", score: 1, reasonKey: null, tag: null, href: "/x" },
        ],
        appointments: [],
        activity: [],
      },
    }),
    op({
      view: {
        metrics: [{ key: "atRisk", value: 3 }],
        leads: [
          { id: "b", name: "B", status: "new", temperature: "hot", score: 1, reasonKey: null, tag: null, href: "/x" },
          { id: "c", name: "C", status: "new", temperature: "hot", score: 1, reasonKey: null, tag: null, href: "/x" },
        ],
        appointments: [],
        activity: [],
      },
    }),
  ]);
  assert.deepEqual(merged.metrics.map((m) => m.key), ["totalLeads", "atRisk"]);
  assert.deepEqual(merged.leads.map((l) => l.id), ["a", "b", "c"]);
});
