/**
 * Ask LeadFlow — the pure orchestration flow.
 *
 * FLEXIBLE CONVERSATION + CONSTRAINED DATA ACCESS + GROUNDED ANSWERS.
 *
 * Deterministic and dependency-injected so it runs under `node --test`: every
 * side-effecting collaborator (the planner call, operation execution, the
 * usage gate, the grounded answer call, usage recording) is passed in.
 * `service.ts` wires the real ones; `actions.ts` adds the auth boundary.
 *
 *   check org hard-usage gate (once, up front)
 *   → AI query planner → QueryPlan            [gate permitting]
 *       • schema-invalid / unknown op / unknown filter → ask for clarification
 *       • model flagged ambiguous                       → ask for clarification
 *       • gate blocked / planner unavailable            → keyword-router fallback (ONE operation)
 *   → strict validation (parsePlan) → allowlisted operations
 *   → execute each operation deterministically, tenant-scoped
 *   → build a GroundingContext from the structured results
 *       • every operation empty        → deterministic "no data" line, no answer call
 *       • single pure count operation  → deterministic templated answer, no answer call
 *       • otherwise + gate ok          → ONE grounded answer call over the GroundingContext
 *       • otherwise + gate blocked     → deterministic data only, "limit reached"
 *
 * The model interprets language; it never chooses SQL, a table, a column, or a
 * tool. An unknown or injected operation/filter is rejected by `parsePlan` and
 * is NEVER executed.
 */

import { MAX_OPERATIONS, parsePlan, type PlannedOperation } from "./plan.ts";
import {
  buildGroundingContext,
  mergeViews,
  renderGroundingText,
  type ExecutedOperation,
  type GroundedView,
} from "./grounding.ts";
import type { ConversationTurn, GroundedAnswer, PlanCall } from "./answer.ts";
import type { TokenUsage } from "@/lib/metering/pricing";
import type { Locale } from "@/i18n/config";

export type AskState =
  | "answered"
  | "no_data"
  | "limit_reached"
  | "answer_unavailable"
  | "needs_clarification";

/** Which usage bucket a recorded call belongs to. */
export type AskUsageKind = "sales_manager" | "sales_manager_interpret";

export interface AskResult {
  question: string;
  state: AskState;
  /** The model's prose answer, already in the user's language. `null` for a deterministic state. */
  answer: string | null;
  /** Dotted dictionary key for a deterministic answer line. `null` when `answer` is set. */
  answerKey: string | null;
  answerParams: Record<string, string | number> | null;
  /** Merged deterministic metrics + lead / appointment / activity cards for the UI. */
  view: GroundedView;
  /** The operation types that actually executed. */
  operations: string[];
  /** True when this question spent at least one Anthropic call. */
  aiUsed: boolean;
  route: "planned" | "fallback" | "clarification";
}

/** One prior turn of the Ask LeadFlow conversation, for follow-up understanding. */
export type { ConversationTurn } from "./answer.ts";

export interface AskDeps {
  /** The small structured planner call. Never throws (`raw: null` on failure). */
  plan: (question: string, history: ConversationTurn[]) => Promise<PlanCall>;
  /** Offline keyword router → ONE bounded operation. Used only when planning yields nothing. */
  routeFallback: (question: string) => PlannedOperation;
  /** Execute validated operations against tenant-scoped data. */
  execute: (operations: PlannedOperation[], now: Date) => Promise<ExecutedOperation[]>;
  /** Reuse the Phase O gate — resolves to whether a NEW Anthropic call is allowed. */
  checkGate: () => Promise<{ allowed: boolean }>;
  /** The single grounded answer call. Never throws (empty text on failure). */
  generateAnswer: (
    groundingText: string,
    history: ConversationTurn[],
  ) => Promise<GroundedAnswer>;
  /** Record one call's usage under the given bucket. Never throws. */
  recordUsage: (input: {
    kind: AskUsageKind;
    model: string;
    usage: TokenUsage;
    requestId: string;
  }) => Promise<void>;
  /** Recent prior turns (already trimmed / capped by the caller). */
  history: ConversationTurn[];
  locale: Locale;
  now?: Date;
  /** Idempotency base for the usage records (one per question). */
  requestId?: string;
}

const CLARIFY_KEY = "askLeadFlow.clarify.generic";
const NO_DATA_KEY = "askLeadFlow.noData.generic";

function metricNumber(view: GroundedView, key: string): number {
  const m = view.metrics.find((x) => x.key === key);
  const n = typeof m?.value === "number" ? m.value : Number(m?.value);
  return Number.isFinite(n) ? n : 0;
}

function metricRaw(view: GroundedView, key: string): string | number {
  const m = view.metrics.find((x) => x.key === key);
  return m?.value ?? 0;
}

/**
 * A deterministic templated answer for a plan that is exactly ONE pure count /
 * summary operation — no grounded answer call is spent for those.
 */
function deterministicAnswer(
  ops: ExecutedOperation[],
  view: GroundedView,
): { key: string; params: Record<string, string | number> } | null {
  if (ops.length !== 1) return null;
  const op = ops[0];
  switch (op.type) {
    case "lead_count":
      return {
        key: "askLeadFlow.deterministic.totalLeads",
        params: { count: Number(op.data.count ?? 0) },
      };
    case "appointment_count":
      return {
        key: "askLeadFlow.deterministic.appointmentCount",
        params: { count: Number(op.data.count ?? 0) },
      };
    case "lead_count_grouped": {
      const total = Number(op.data.total ?? 0);
      const groupKey =
        "by_status" in op.data
          ? "askLeadFlow.deterministic.leadCountByStatus"
          : "hot" in op.data
            ? "askLeadFlow.deterministic.leadCountByOpportunity"
            : "askLeadFlow.deterministic.leadSourceBreakdown";
      return groupKey === "askLeadFlow.deterministic.leadCountByOpportunity"
        ? { key: groupKey, params: { total, hot: Number(op.data.hot ?? 0) } }
        : { key: groupKey, params: { total, sources: view.metrics.length } };
    }
    case "conversion_summary":
      return {
        key: "askLeadFlow.deterministic.conversionSummary",
        params: {
          total: metricNumber(view, "totalLeads"),
          won: metricNumber(view, "won"),
          rate: String(metricRaw(view, "conversionRate")),
        },
      };
    default:
      return null;
  }
}

function clarificationResult(
  question: string,
  text: string | null,
  aiUsed: boolean,
): AskResult {
  return {
    question,
    state: "needs_clarification",
    answer: text,
    answerKey: text ? null : CLARIFY_KEY,
    answerParams: null,
    view: mergeViews([]),
    operations: [],
    aiUsed,
    route: "clarification",
  };
}

export async function runAsk(question: string, deps: AskDeps): Promise<AskResult> {
  const now = deps.now ?? new Date();
  const baseId = deps.requestId ?? crypto.randomUUID();
  const history = deps.history ?? [];

  // Respect a per-org hard usage limit BEFORE the planner AI call.
  const gate = await deps.checkGate();

  let operations: PlannedOperation[] | null = null;
  let aiUsed = false;
  let route: AskResult["route"] = "fallback";

  if (gate.allowed) {
    const call = await deps.plan(question, history);
    if (call.raw !== null) {
      aiUsed = true;
      if (call.usage) {
        await deps.recordUsage({
          kind: "sales_manager_interpret",
          model: call.model,
          usage: call.usage,
          requestId: `${baseId}:plan`,
        });
      }
      const parsed = parsePlan(call.raw);
      if (!parsed.ok) {
        // Schema-invalid, an unknown operation/filter, or too many operations
        // — never execute a "best guess". Ask the user to rephrase.
        return clarificationResult(question, null, aiUsed);
      }
      if (parsed.plan.needsClarification && parsed.plan.operations.length === 0) {
        return clarificationResult(question, parsed.plan.clarificationQuestion, aiUsed);
      }
      operations = parsed.plan.operations.slice(0, MAX_OPERATIONS);
      route = "planned";
    }
  }

  // Planner unavailable (gate blocked, or the call failed) → keyword fallback.
  if (!operations) {
    operations = [deps.routeFallback(question)];
    route = "fallback";
  }

  const executed = await deps.execute(operations, now);
  const view = mergeViews(executed);
  const opTypes = executed.map((o) => o.type);
  const base = {
    question,
    view,
    operations: opTypes,
    answer: null as string | null,
    answerParams: null as Record<string, string | number> | null,
    route,
  };

  // Every operation came back empty → deterministic "no data".
  if (executed.length > 0 && executed.every((o) => o.empty)) {
    return { ...base, state: "no_data", answerKey: NO_DATA_KEY, aiUsed };
  }

  // Exactly one pure count/summary op → deterministic templated answer, no answer call.
  const det = deterministicAnswer(executed, view);
  if (det) {
    return {
      ...base,
      state: "answered",
      answerKey: det.key,
      answerParams: det.params,
      aiUsed,
    };
  }

  // A grounded answer call is needed — respect the hard usage limit.
  if (!gate.allowed) {
    return { ...base, state: "limit_reached", answerKey: "askLeadFlow.limitReached", aiUsed };
  }

  const groundingText = renderGroundingText(
    buildGroundingContext(question, executed, now),
  );
  const answer = await deps.generateAnswer(groundingText, history);

  if (!answer.text) {
    return {
      ...base,
      state: "answer_unavailable",
      answerKey: "askLeadFlow.answerUnavailable",
      aiUsed,
    };
  }

  if (answer.usage) {
    await deps.recordUsage({
      kind: "sales_manager",
      model: answer.model,
      usage: answer.usage,
      requestId: `${baseId}:answer`,
    });
  }

  return {
    ...base,
    state: "answered",
    answer: answer.text,
    answerKey: null,
    aiUsed: true,
  };
}
