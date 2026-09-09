/**
 * Ask LeadFlow — server-only wiring for {@link runAsk}.
 *
 * Binds the real collaborators: the small structured interpretation call, the
 * allowlisted intent retrieval layer, the Phase O usage gate + metering, and
 * the single grounded Anthropic call. The caller (`actions.ts`) has already
 * resolved `organizationId` from the authenticated user's membership and
 * checked the owner/admin role.
 */

import "server-only";

import { CHAT_MODEL, getAnthropicClient } from "@/lib/chat/anthropic";
import { checkUsageAllowed } from "@/lib/metering/enforcement";
import { recordAiUsage } from "@/lib/metering/service";
import { en } from "@/i18n/dictionaries/en";
import { createTranslator } from "@/i18n/translate";
import type { Locale } from "@/i18n/config";
import { generateGroundedAnswer, interpretQuestion } from "./answer.ts";
import { routeQuestion } from "./intents.ts";
import { runIntent } from "./retrieval.ts";
import { runAsk, type AskResult } from "./orchestration.ts";

// English resolver for the compact model context — the answer is asked to come
// back in the user's own locale, but the DATA block stays English + compact.
const tEn = createTranslator(en);

export interface AskLeadFlowInput {
  question: string;
  organizationId: string;
  locale: Locale;
  /** One id per question — makes the usage records idempotent on a double submit. */
  requestId?: string;
  now?: Date;
}

export async function askLeadFlow(input: AskLeadFlowInput): Promise<AskResult> {
  const requestId = input.requestId ?? crypto.randomUUID();

  return runAsk(input.question, {
    now: input.now,
    requestId,
    locale: input.locale,
    reason: (key, params) => tEn(key, params),
    metricLabel: (key) => tEn(`askLeadFlow.metrics.${key}`),

    routeFallback: (question) => routeQuestion(question).intent,

    interpret: async (question) => {
      let client;
      try {
        client = getAnthropicClient();
      } catch {
        return { raw: null, usage: null, model: CHAT_MODEL };
      }
      return interpretQuestion(client, question, { now: input.now });
    },

    runIntent: (intent, params, now) =>
      runIntent(intent, input.organizationId, params, now),

    checkGate: async () => {
      const gate = await checkUsageAllowed(input.organizationId, { now: input.now });
      return { allowed: gate.allowed };
    },

    generateAnswer: async (context) => {
      let client;
      try {
        client = getAnthropicClient();
      } catch {
        return { text: "", usage: null, model: CHAT_MODEL };
      }
      return generateGroundedAnswer(client, context);
    },

    recordUsage: async ({ kind, model, usage, requestId: rid }) => {
      await recordAiUsage({
        organizationId: input.organizationId,
        requestType: kind,
        model,
        channel: "dashboard",
        usage,
        conversationId: null,
        leadId: null,
        requestId: rid,
      });
    },
  });
}
