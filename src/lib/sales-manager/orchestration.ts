/**
 * Ask LeadFlow — the pure orchestration flow.
 *
 * Deterministic and dependency-injected so it runs under `node --test`: every
 * side-effecting collaborator (intent retrieval, the usage gate, the Anthropic
 * call, usage recording) is passed in. `service.ts` wires the real ones;
 * `actions.ts` adds the auth boundary on top.
 *
 * Flow:
 *   route question → run ONE allowlisted intent (deterministic) →
 *     • no data                → deterministic answer, NO Anthropic call
 *     • org over a hard limit   → deterministic answer, NO Anthropic call
 *     • otherwise               → ONE grounded Anthropic call, record usage
 */

import { routeQuestion, type AskIntent } from "./intents.ts";
import type { IntentResult } from "./ranking.ts";
import { buildAnswerContext, type GroundedAnswer, type ReasonFn } from "./answer.ts";
import type { TokenUsage } from "@/lib/metering/pricing";
import type { Locale } from "@/i18n/config";

export type AskState = "answered" | "no_data" | "limit_reached" | "answer_unavailable";

export interface AskResult {
  question: string;
  intent: AskIntent;
  state: AskState;
  /** The model's prose answer, already in the user's locale. `null` for a deterministic state. */
  answer: string | null;
  /** Dotted dictionary key for a deterministic answer line. `null` when `answer` is set. */
  answerKey: string | null;
  /** Deterministic metrics + lead / appointment / activity cards for the UI. */
  result: IntentResult;
  /** True when this question actually spent an Anthropic call. */
  aiUsed: boolean;
}

export interface AskDeps {
  runIntent: (intent: AskIntent, now: Date) => Promise<IntentResult>;
  /** Reuse the Phase O gate — resolves to whether a NEW Anthropic call is allowed. */
  checkGate: () => Promise<{ allowed: boolean }>;
  /** The single grounded Anthropic call. Never throws (empty text on failure). */
  generateAnswer: (context: string) => Promise<GroundedAnswer>;
  /** Record the call under request type `sales_manager`. Never throws. */
  recordUsage: (input: {
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
  /** Idempotency key for the usage record (one per question). */
  requestId?: string;
}

const NO_DATA_KEY: Record<AskIntent, string> = {
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

export async function runAsk(question: string, deps: AskDeps): Promise<AskResult> {
  const now = deps.now ?? new Date();
  const { intent } = routeQuestion(question);
  const result = await deps.runIntent(intent, now);

  const base = { question, intent, result, answer: null as string | null };

  // No data → deterministic, no Anthropic call.
  if (result.empty) {
    return { ...base, state: "no_data", answerKey: NO_DATA_KEY[intent], aiUsed: false };
  }

  // Respect a per-org hard usage limit BEFORE spending a call.
  const gate = await deps.checkGate();
  if (!gate.allowed) {
    return { ...base, state: "limit_reached", answerKey: "askLeadFlow.limitReached", aiUsed: false };
  }

  const context = buildAnswerContext({
    question,
    result,
    locale: deps.locale,
    reason: deps.reason,
    metricLabel: deps.metricLabel,
  });
  const answer = await deps.generateAnswer(context);

  // The model produced nothing usable — show the deterministic data with a note.
  if (!answer.text) {
    return {
      ...base,
      state: "answer_unavailable",
      answerKey: "askLeadFlow.answerUnavailable",
      aiUsed: false,
    };
  }

  if (answer.usage) {
    await deps.recordUsage({
      model: answer.model,
      usage: answer.usage,
      requestId: deps.requestId ?? crypto.randomUUID(),
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
