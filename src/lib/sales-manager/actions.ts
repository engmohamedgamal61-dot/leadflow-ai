"use server";

import { requireOrganizationContext } from "@/lib/org/context";
import { canManageConfig } from "@/lib/org/roles";
import { getLocale } from "@/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit, salesManagerRule } from "@/lib/security/rate-limit";
import { askLeadFlow } from "./service.ts";
import type { AskResult } from "./orchestration.ts";

const MAX_QUESTION_LENGTH = 500;

export type AskLeadFlowActionResult =
  | { ok: true; data: AskResult }
  | { ok: false; errorCode: string };

/**
 * The one entry point the Ask LeadFlow panel calls.
 *
 * Security: `requireOrganizationContext` (redirects if unauthenticated / no
 * org) + `canManageConfig` — owner/admin only, the same bar as Usage & Cost
 * and the AI settings. `organizationId` is derived from the membership, never
 * accepted from the client; every intent query then runs under that member's
 * RLS-scoped session client. This phase is insight-only: no writes, no tools,
 * no arbitrary queries.
 */
export async function askLeadFlowAction(
  question: string,
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

  // Per-org rate limit BEFORE any intent query or Anthropic call. Fails open
  // (like the chat limiter) — the Phase O hard usage limit is the harder stop.
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
      locale,
    });
    return { ok: true, data };
  } catch (error) {
    console.error("[sales-manager] askLeadFlowAction failed:", error);
    return { ok: false, errorCode: "askLeadFlow.errors.unavailable" };
  }
}
