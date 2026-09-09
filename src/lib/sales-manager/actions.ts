"use server";

import { requireOrganizationContext } from "@/lib/org/context";
import { canManageConfig } from "@/lib/org/roles";
import { getLocale } from "@/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit, salesManagerRule } from "@/lib/security/rate-limit";
import { askLeadFlow } from "./service.ts";
import type { AskResult, ConversationTurn } from "./orchestration.ts";

const MAX_QUESTION_LENGTH = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_TURN_LENGTH = 2000;

export type AskLeadFlowActionResult =
  | { ok: true; data: AskResult }
  | { ok: false; errorCode: string };

/** Client-supplied prior turn — untrusted, sanitised below. */
export interface AskHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The one entry point the Ask LeadFlow panel calls.
 *
 * Security: `requireOrganizationContext` (redirects if unauthenticated / no
 * org) + `canManageConfig` — owner/admin only, the same bar as Usage & Cost
 * and the AI settings. `organizationId` is derived from the membership, never
 * accepted from the client; every data operation runs under that member's
 * RLS-scoped session client. This phase is insight-only: no writes, no tools,
 * no arbitrary queries. `history` is only conversation TEXT (for follow-up
 * understanding) — never a factual source; every answer re-queries the data.
 */
export async function askLeadFlowAction(
  question: string,
  history: AskHistoryTurn[] = [],
): Promise<AskLeadFlowActionResult> {
  const { membership } = await requireOrganizationContext();

  if (!canManageConfig(membership.role)) {
    return { ok: false, errorCode: "askLeadFlow.errors.forbidden" };
  }

  const trimmed = typeof question === "string" ? question.trim() : "";
  if (!trimmed) {
    return { ok: false, errorCode: "askLeadFlow.errors.empty" };
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return { ok: false, errorCode: "askLeadFlow.errors.tooLong" };
  }

  const safeHistory: ConversationTurn[] = (Array.isArray(history) ? history : [])
    .filter(
      (t): t is AskHistoryTurn =>
        !!t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({
      role: t.role,
      content: t.content.trim().slice(0, MAX_HISTORY_TURN_LENGTH),
    }));

  // Per-org rate limit BEFORE any query or Anthropic call. Fails open (like the
  // chat limiter) — the Phase O hard usage limit is the harder stop.
  try {
    const admin = createAdminClient();
    const gate = await enforceRateLimit(admin, salesManagerRule(membership.organizationId));
    if (!gate.allowed) {
      return { ok: false, errorCode: "askLeadFlow.errors.rateLimited" };
    }
  } catch {
    /* Supabase not configured — skip, same as the chat route. */
  }

  const locale = await getLocale();

  try {
    const data = await askLeadFlow({
      question: trimmed,
      organizationId: membership.organizationId,
      industryTemplateId: membership.industryTemplateId,
      locale,
      history: safeHistory,
    });
    return { ok: true, data };
  } catch (error) {
    console.error("[sales-manager] askLeadFlowAction failed:", error);
    return { ok: false, errorCode: "askLeadFlow.errors.unavailable" };
  }
}
