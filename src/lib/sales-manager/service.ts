/**
 * Ask LeadFlow — server-only wiring for {@link runAsk}.
 *
 * Binds the real collaborators: the AI query planner, the allowlisted
 * operation-execution layer, the Phase O usage gate + metering, and the single
 * grounded answer call. The caller (`actions.ts`) has already resolved
 * `organizationId` from the authenticated user's membership and checked the
 * owner/admin role.
 */

import "server-only";

import { CHAT_MODEL, getAnthropicClient } from "@/lib/chat/anthropic";
import { checkUsageAllowed } from "@/lib/metering/enforcement";
import { recordAiUsage } from "@/lib/metering/service";
import { loadEffectiveConfig } from "@/lib/config/organization-config.server";
import type { Locale } from "@/i18n/config";
import { generateGroundedAnswer, planQuestion } from "./answer.ts";
import { routeQuestion } from "./intents.ts";
import { INTENT_TO_OPERATION, type PlannedOperation } from "./plan.ts";
import { executeOperation, type ExecutionContext } from "./operations.ts";
import { runAsk, type AskResult, type ConversationTurn } from "./orchestration.ts";

export interface AskLeadFlowInput {
  question: string;
  organizationId: string;
  industryTemplateId: string;
  locale: Locale;
  /** Recent prior turns of this Ask LeadFlow conversation (client-supplied, sanitised in actions.ts). */
  history?: ConversationTurn[];
  /** One id per question — makes the usage records idempotent on a double submit. */
  requestId?: string;
  now?: Date;
}

async function loadCustomFieldKeys(
  organizationId: string,
  industryTemplateId: string,
): Promise<ReadonlySet<string>> {
  try {
    const config = await loadEffectiveConfig(organizationId, industryTemplateId);
    return new Set(config.leadFields.map((f) => f.key.toLowerCase()));
  } catch {
    return new Set();
  }
}

export async function askLeadFlow(input: AskLeadFlowInput): Promise<AskResult> {
  const requestId = input.requestId ?? crypto.randomUUID();
  const now = input.now ?? new Date();

  const customFieldKeys = await loadCustomFieldKeys(
    input.organizationId,
    input.industryTemplateId,
  );
  const ctx: ExecutionContext = {
    organizationId: input.organizationId,
    now,
    customFieldKeys,
  };

  return runAsk(input.question, {
    now,
    requestId,
    locale: input.locale,
    history: input.history ?? [],

    routeFallback: (question): PlannedOperation =>
      INTENT_TO_OPERATION[routeQuestion(question).intent],

    plan: async (question, history) => {
      let client;
      try {
        client = getAnthropicClient();
      } catch {
        return { raw: null, usage: null, model: CHAT_MODEL };
      }
      return planQuestion(client, question, history, {
        now,
        customFields: [...customFieldKeys],
      });
    },

    execute: async (operations) =>
      Promise.all(operations.map((op) => executeOperation(op, ctx))),

    checkGate: async () => {
      const gate = await checkUsageAllowed(input.organizationId, { now });
      return { allowed: gate.allowed };
    },

    generateAnswer: async (groundingText, history) => {
      let client;
      try {
        client = getAnthropicClient();
      } catch {
        return { text: "", usage: null, model: CHAT_MODEL };
      }
      return generateGroundedAnswer(client, {
        groundingText,
        history,
        locale: input.locale,
      });
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
