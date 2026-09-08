"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganizationContext } from "@/lib/org/context";
import { canManageConfig } from "@/lib/org/roles";
import type { TablesInsert } from "@/lib/supabase/types";

/**
 * Write path for the per-org monthly usage limits.
 *
 * Security: `requireOrganizationContext` + `canManageConfig` (owner/admin — the
 * same set as the `organization_usage_limits` RLS policies), and the upsert
 * then runs on the RLS-scoped session client, so the database is the real gate.
 * A viewer / manager / sales session is rejected here AND by RLS.
 */

export interface UsageLimitsFormState {
  ok?: boolean;
  /** Dotted dictionary key. */
  errorCode?: string;
}

/**
 * Parse an optional non-negative integer field. Empty / blank → `null` (no
 * limit). Returns `undefined` on an invalid value so the caller can reject.
 */
function optionalCount(raw: FormDataEntryValue | null): number | null | undefined {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/** Optional non-negative money value (2 dp). Empty → `null`. */
function optionalMoney(raw: FormDataEntryValue | null): number | null | undefined {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

export async function updateUsageLimitsAction(
  _prev: UsageLimitsFormState,
  formData: FormData,
): Promise<UsageLimitsFormState> {
  const { user, membership } = await requireOrganizationContext();

  if (!canManageConfig(membership.role)) {
    return { errorCode: "settingsUsage.errors.onlyOwnerAdmin" };
  }

  const tokenLimit = optionalCount(formData.get("tokenLimit"));
  const requestLimit = optionalCount(formData.get("requestLimit"));
  const costLimit = optionalMoney(formData.get("costLimit"));

  const thresholdRaw = Number(String(formData.get("warningThreshold") ?? "").trim());
  const warningThreshold =
    Number.isFinite(thresholdRaw) && thresholdRaw >= 1 && thresholdRaw <= 100
      ? Math.round(thresholdRaw)
      : undefined;

  const hardLimitEnabled = formData.get("hardLimitEnabled") === "on";

  if (
    tokenLimit === undefined ||
    requestLimit === undefined ||
    costLimit === undefined ||
    warningThreshold === undefined
  ) {
    return { errorCode: "settingsUsage.errors.invalid" };
  }

  const row: TablesInsert<"organization_usage_limits"> = {
    organization_id: membership.organizationId,
    monthly_token_limit: tokenLimit,
    monthly_request_limit: requestLimit,
    monthly_cost_limit_usd: costLimit,
    warning_threshold_percent: warningThreshold,
    hard_limit_enabled: hardLimitEnabled,
    updated_by: user.id,
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_usage_limits")
    .upsert(row, { onConflict: "organization_id" })
    .select("organization_id");

  if (error || !data || data.length === 0) {
    return { errorCode: "settingsUsage.errors.noPermission" };
  }

  revalidatePath("/dashboard/settings/usage");
  return { ok: true };
}
