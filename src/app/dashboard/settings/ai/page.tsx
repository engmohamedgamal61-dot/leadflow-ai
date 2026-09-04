import type { Metadata } from "next";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { getIndustryTemplate, effectiveConfigFromStored } from "@/lib/config";
import { loadStoredConfig } from "@/lib/config/organization-config.server";
import { maxScore } from "@/lib/lead-scoring";
import { AiBehaviorForm } from "./ai-behavior-form";
import { QualificationForm, type QualRow } from "./qualification-form";
import { ScoringForm } from "./scoring-form";

export const metadata: Metadata = { title: "AI agent — LeadFlow AI" };

export default async function AiSettingsPage() {
  const { membership } = await requireOrganizationContext();
  const template = getIndustryTemplate(membership.industryTemplateId);
  const canManage = canManageConfig(membership.role);

  if (!template) {
    return (
      <p className="rounded-xl border border-border bg-surface px-4 py-8 text-sm text-muted">
        No industry template is configured for this workspace.
      </p>
    );
  }

  const stored = await loadStoredConfig(membership.organizationId);
  const effective = effectiveConfigFromStored(
    membership.organizationId,
    membership.industryTemplateId,
    stored,
  );

  const flowHints = new Map(
    effective.qualificationFlow.map((s) => [s.fieldKey, s.questionHint ?? ""]),
  );
  const templateFlowHints = new Map(
    template.qualificationFlow.map((s) => [s.fieldKey, s.questionHint ?? ""]),
  );
  const templateFlowKeys = new Set(
    template.qualificationFlow.map((s) => s.fieldKey),
  );

  const rows: QualRow[] = effective.leadFields.map((f) => ({
    key: f.key,
    label: f.label,
    enabled: f.enabled,
    order: f.order,
    questionHint: flowHints.get(f.key) ?? templateFlowHints.get(f.key) ?? "",
    inFlow: templateFlowKeys.has(f.key),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">AI agent</h1>
        <p className="mt-1 text-sm text-muted">
          Customize how the {template.name} qualification assistant behaves.
          Changes apply to new chat messages immediately.
        </p>
        {!canManage ? (
          <p className="mt-2 inline-block rounded-md border border-border bg-background px-2 py-1 text-xs text-muted">
            Read-only — an owner or admin can edit these settings.
          </p>
        ) : null}
      </div>

      <AiBehaviorForm
        effective={effective.aiBehavior}
        templateDefaults={template.aiBehavior}
        canManage={canManage}
      />

      <QualificationForm rows={rows} canManage={canManage} />

      <ScoringForm
        hot={effective.scoring.thresholds.hot}
        warm={effective.scoring.thresholds.warm}
        templateHot={template.scoring.thresholds.hot}
        templateWarm={template.scoring.thresholds.warm}
        maxScore={maxScore(effective.scoring)}
        canManage={canManage}
      />
    </div>
  );
}
