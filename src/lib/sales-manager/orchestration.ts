/**
 * Ask LeadFlow — the pure orchestration flow.
 *
 * Deterministic and dependency-injected so it runs under `node --test`: every
 * side-effecting collaborator (interpretation call, intent retrieval, the usage
 * gate, the grounded answer call, usage recording) is passed in. `service.ts`
 * wires the real ones; `actions.ts` adds the auth boundary on top.
 *
 * Flow:
 *   check org hard-usage gate (once, up front)
 *   → interpret the question with ONE small AI call        [gate permitting]
 *       • output schema-invalid / unknown intent → ask for clarification
 *       • model unsure / flagged ambiguous       → ask for clarification
 *       • gate blocked / AI unavailable          → keyword-router fallback
 *   → run ONE allowlisted, tenant-scoped intent query (deterministic)
 *       • no data                → deterministic "no data" line, no answer call
 *       • count / breakdown intent → deterministic templated answer, no answer call
 *       • otherwise + gate ok      → ONE grounded answer call
 *       • otherwise + gate blocked → deterministic data only, "limit reached"
 *
 * The model interprets language; it never chooses SQL, a table, or a tool. An
 * unknown or injected `intent` is rejected by `parseInterpretation` and is
 * NEVER mapped to a real query.
 */

import { DETERMINISTIC_INTENTS, type AskIntent } from "./intents.ts";
import {
  DEFAULT_INTENT_PARAMS,
  parseInterpretation,
  shouldClarify,
  type IntentParams,
} from "./interpretation.ts";
import type { IntentResult } from "./ranking.ts";
import {
  buildAnswerContext,
  type GroundedAnswer,
  type InterpretationCall,
  type ReasonFn,
} from "./answer.ts";
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
  intent: AskIntent;
  state: AskState;
  /** The model's prose answer, already in the user's locale. `null` for a deterministic state. */
  answer: string | null;
  /** Dotted dictionary key for a deterministic answer line. `null` when `answer` is set. */
  answerKey: string | null;
  /** Interpolation params for `answerKey` (deterministic count answers). */
  answerParams: Record<string, string | number> | null;
  /** Deterministic metrics + lead / appointment / activity cards for the UI. */
  result: IntentResult;
  /** True when this question spent at least one Anthropic call. */
  aiUsed: boolean;
  /** How the intent was chosen — useful for tests / debugging, safe to expose. */
  route: "interpreted" | "fallback" | "clarification";
}

export interface AskDeps {
  /** The small structured interpretation call. Never throws (`raw: null` on failure). */
  interpret: (question: string) => Promise<InterpretationCall>;
  /** Offline keyword router — used only when interpretation yields no usable intent. */
  routeFallback: (question: string) => AskIntent;
  /** Run one allowlisted, tenant-scoped intent query. */
  runIntent: (
    intent: AskIntent,
    params: IntentParams,
    now: Date,
  ) => Promise<IntentResult>;
  /** Reuse the Phase O gate — resolves to whether a NEW Anthropic call is allowed. */
  checkGate: () => Promise<{ allowed: boolean }>;
  /** The single grounded Anthropic call. Never throws (empty text on failure). */
  generateAnswer: (context: string) => Promise<GroundedAnswer>;
  /** Record one call's usage under the given bucket. Never throws. */
  recordUsage: (input: {
    kind: AskUsageKind;
    model: string;
    usage: TokenUsage;
    requestId: string;
  }) => Promise<void>;
  locale: Locale;
  /** Resolve a reason dictionary key to English text, for the model context. */
  reason: ReasonFn;
  /** Resolve a metric-label dictionary key to English text, for the model context. */
  metricLabel: (key: string) => string;
  now?: Date;
  /** Idempotency base for the usage records (one per question). */
  requestId?: string;
}

const NO_DATA_KEY: Record<AskIntent, string> = {
  total_leads: "askLeadFlow.noData.totalLeads",
  lead_count_by_status: "askLeadFlow.noData.leadCountByStatus",
  lead_count_by_opportunity: "askLeadFlow.noData.leadCountByOpportunity",
  lead_source_breakdown: "askLeadFlow.noData.leadSourceBreakdown",
  qualified_leads: "askLeadFlow.noData.qualifiedLeads",
  appointment_count: "askLeadFlow.noData.appointmentCount",
  follow_up_count: "askLeadFlow.noData.followUpCount",
  conversion_summary: "askLeadFlow.noData.conversionSummary",
  priority_leads: "askLeadFlow.noData.priorityLeads",
  needs_attention: "askLeadFlow.noData.needsAttention",
  at_risk_leads: "askLeadFlow.noData.atRisk",
  upcoming_appointments: "askLeadFlow.noData.upcomingAppointments",
  overdue_followups: "askLeadFlow.noData.overdueFollowups",
  recovery_opportunities: "askLeadFlow.noData.recovery",
  recent_activity: "askLeadFlow.noData.recentActivity",
  pipeline_summary: "askLeadFlow.noData.pipeline",
  weekly_changes: "askLeadFlow.noData.weeklyChanges",
};

const emptyResult = (intent: AskIntent): IntentResult => ({
  intent,
  metrics: [],
  leads: [],
  appointments: [],
  activity: [],
  empty: true,
});

function metricNumber(result: IntentResult, key: string): number {
  const m = result.metrics.find((x) => x.key === key);
  const n = typeof m?.value === "number" ? m.value : Number(m?.value);
  return Number.isFinite(n) ? n : 0;
}

function metricRaw(result: IntentResult, key: string): string | number {
  const m = result.metrics.find((x) => x.key === key);
  return m?.value ?? 0;
}

/**
 * Build the deterministic, templated answer for a count / breakdown intent —
 * no Anthropic call. Directly addresses the question ("You have N …") and
 * leaves the breakdown itself to the metrics grid.
 */
function deterministicAnswer(
  intent: AskIntent,
  result: IntentResult,
): { key: string; params: Record<string, string | number> } {
  switch (intent) {
    case "total_leads":
      return {
        key: "askLeadFlow.deterministic.totalLeads",
        params: { count: metricNumber(result, "totalLeads") },
      };
    case "qualified_leads":
      return {
        key: "askLeadFlow.deterministic.qualifiedLeads",
        params: { count: metricNumber(result, "qualified") },
      };
    case "appointment_count":
      return {
        key: "askLeadFlow.deterministic.appointmentCount",
        params: { count: metricNumber(result, "upcomingAppointments") },
      };
    case "follow_up_count":
      return {
        key: "askLeadFlow.deterministic.followUpCount",
        params: {
          open: metricNumber(result, "openFollowUps"),
          due: metricNumber(result, "followUpsDue"),
          failed: metricNumber(result, "failedFollowUps"),
        },
      };
    case "lead_count_by_status":
      return {
        key: "askLeadFlow.deterministic.leadCountByStatus",
        params: { total: metricNumber(result, "totalLeads") },
      };
    case "lead_count_by_opportunity":
      return {
        key: "askLeadFlow.deterministic.leadCountByOpportunity",
        params: {
          total: metricNumber(result, "totalLeads"),
          hot: metricNumber(result, "hot"),
        },
      };
    case "lead_source_breakdown":
      return {
        key: "askLeadFlow.deterministic.leadSourceBreakdown",
        params: { sources: result.metrics.length },
      };
    case "conversion_summary":
      return {
        key: "askLeadFlow.deterministic.conversionSummary",
        params: {
          total: metricNumber(result, "totalLeads"),
          won: metricNumber(result, "won"),
          rate: String(metricRaw(result, "conversionRate")),
        },
      };
    default:
      return { key: "askLeadFlow.answerUnavailable", params: {} };
  }
}

export async function runAsk(question: string, deps: AskDeps): Promise<AskResult> {
  const now = deps.now ?? new Date();
  const baseId = deps.requestId ?? crypto.randomUUID();

  // Respect a per-org hard usage limit BEFORE the interpretation AI call.
  const gate = await deps.checkGate();

  let intent: AskIntent | null = null;
  let params: IntentParams = DEFAULT_INTENT_PARAMS;
  let aiUsed = false;
  let route: AskResult["route"] = "fallback";
  let clarification: { text: string | null } | null = null;

  if (gate.allowed) {
    const call = await deps.interpret(question);
    if (call.raw !== null) {
      aiUsed = true;
      if (call.usage) {
        await deps.recordUsage({
          kind: "sales_manager_interpret",
          model: call.model,
          usage: call.usage,
          requestId: `${baseId}:interpret`,
        });
      }
      const parsed = parseInterpretation(call.raw);
      if (!parsed.ok) {
        // Schema-invalid or an unknown / injected intent — never map to a
        // real query. Ask the user to rephrase.
        clarification = { text: null };
      } else if (shouldClarify(parsed.value)) {
        clarification = { text: parsed.value.clarificationQuestion };
      } else {
        intent = parsed.value.intent;
        params = {
          filters: parsed.value.filters,
          timeRange: parsed.value.timeRange,
          limit: parsed.value.limit,
        };
        route = "interpreted";
      }
    }
  }

  if (clarification) {
    return {
      question,
      intent: deps.routeFallback(question),
      state: "needs_clarification",
      answer: clarification.text,
      answerKey: clarification.text ? null : "askLeadFlow.clarify.generic",
      answerParams: null,
      result: emptyResult(deps.routeFallback(question)),
      aiUsed,
      route: "clarification",
    };
  }

  // Interpretation didn't yield an intent (gate blocked it, or AI unavailable).
  if (!intent) {
    intent = deps.routeFallback(question);
    params = DEFAULT_INTENT_PARAMS;
    route = "fallback";
  }

  const result = await deps.runIntent(intent, params, now);
  const base = {
    question,
    intent,
    result,
    answer: null as string | null,
    answerParams: null as Record<string, string | number> | null,
    route,
  };

  // No data → deterministic, no answer call.
  if (result.empty) {
    return { ...base, state: "no_data", answerKey: NO_DATA_KEY[intent], aiUsed };
  }

  // Count / breakdown intent → deterministic templated answer, no answer call.
  if (DETERMINISTIC_INTENTS.has(intent)) {
    const det = deterministicAnswer(intent, result);
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
    return {
      ...base,
      state: "limit_reached",
      answerKey: "askLeadFlow.limitReached",
      aiUsed,
    };
  }

  const context = buildAnswerContext({
    question,
    result,
    locale: deps.locale,
    reason: deps.reason,
    metricLabel: deps.metricLabel,
  });
  const answer = await deps.generateAnswer(context);

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
