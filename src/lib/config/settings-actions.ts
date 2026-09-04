"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/types";
import { requireOrganizationContext } from "@/lib/org/context";
import { canManageConfig } from "@/lib/org/roles";
import { getIndustryTemplate, type IndustryTemplate } from "@/lib/config";
import { loadStoredConfig } from "@/lib/config/organization-config.server";
import {
  compactStoredConfig,
  validateStoredConfig,
  diffAiBehavior,
  diffQualification,
  diffScoringThresholds,
  type StoredOrgConfig,
  type FieldForm,
  type AiBehaviorForm,
} from "@/lib/config/organization-config";

export interface SettingsFormState {
  ok?: boolean;
  error?: string;
  details?: string[];
}

function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Shared write path for every settings section.
 *
 * Security: `requireOrganizationContext` + `canManageConfig` (owner/admin, the
 * same set as the `organization_configs` RLS policies) — and the upsert then
 * runs on the RLS-scoped session client, so the database is the real gate.
 * Each section only patches its own slice of the stored blob, so unrelated
 * overrides (including scoring `rules` the UI doesn't edit) are preserved.
 */
async function saveSection(
  patch: (current: StoredOrgConfig, template: IndustryTemplate) => StoredOrgConfig,
): Promise<SettingsFormState> {
  const { membership } = await requireOrganizationContext();

  if (!canManageConfig(membership.role)) {
    return { error: "Only an owner or admin can change the AI agent settings." };
  }

  const template = getIndustryTemplate(membership.industryTemplateId);
  if (!template) return { error: "Unknown industry template." };

  const current = await loadStoredConfig(membership.organizationId);
  const next = compactStoredConfig(patch(current, template));

  const validation = validateStoredConfig(next, template);
  if (!validation.valid) {
    return { error: "Those settings aren't valid.", details: validation.errors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_configs")
    .upsert(
      {
        organization_id: membership.organizationId,
        config: next as TablesInsert<"organization_configs">["config"],
      },
      { onConflict: "organization_id" },
    )
    .select("organization_id");

  if (error || !data || data.length === 0) {
    return { error: "You don't have permission to change these settings." };
  }

  revalidatePath("/dashboard/settings/ai");
  revalidatePath("/dashboard/leads", "layout");
  return { ok: true };
}

export async function updateAiBehaviorAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const form: AiBehaviorForm = {
    persona: String(formData.get("persona") ?? ""),
    goal: String(formData.get("goal") ?? ""),
    tone: String(formData.get("tone") ?? ""),
    style: String(formData.get("style") ?? ""),
    domainContext: String(formData.get("domainContext") ?? ""),
    languages: lines(formData.get("languages")),
    additionalRules: lines(formData.get("additionalRules")),
  };
  return saveSection((current, template) => ({
    ...current,
    aiBehaviorOverrides: diffAiBehavior(template.aiBehavior, form),
  }));
}

export async function updateQualificationAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "Malformed form data." };
  }
  if (!Array.isArray(raw)) return { error: "Malformed form data." };

  const rows: FieldForm[] = raw
    .map((r) => ({
      key: String((r as { key?: unknown })?.key ?? ""),
      enabled: (r as { enabled?: unknown })?.enabled !== false,
      order: Number((r as { order?: unknown })?.order),
      questionHint: String((r as { questionHint?: unknown })?.questionHint ?? ""),
    }))
    .filter((r) => r.key);

  return saveSection((current, template) => {
    const { fieldOverrides, qualificationOverrides } = diffQualification(
      template,
      rows,
    );
    return { ...current, fieldOverrides, qualificationOverrides };
  });
}

export async function updateScoringAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const hot = Number(formData.get("hot"));
  const warm = Number(formData.get("warm"));

  return saveSection((current, template) => {
    const thresholds = diffScoringThresholds(template.scoring.thresholds, {
      hot,
      warm,
    });
    const so: NonNullable<StoredOrgConfig["scoringOverrides"]> = {
      ...(current.scoringOverrides ?? {}),
    };
    if (thresholds) so.thresholds = thresholds;
    else delete so.thresholds;
    return {
      ...current,
      scoringOverrides:
        so.thresholds || so.rules?.length || so.removeRules?.length
          ? so
          : undefined,
    };
  });
}
