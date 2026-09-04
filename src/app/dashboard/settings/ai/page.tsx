import type { Metadata } from "next";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { getIndustryTemplate, effectiveConfigFromStored } from "@/lib/config";
import { loadStoredConfig } from "@/lib/config/organization-config.server";
import { maxScore } from "@/lib/lead-scoring";
import { getI18n } from "@/i18n/server";
import { AiBehaviorForm } from "./ai-behavior-form";
import { QualificationForm, type QualRow } from "./qualification-form";
import { ScoringForm } from "./scoring-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.aiAgent };
}

export default async function AiSettingsPage() {
  const { membership } = await requireOrganizationContext();
  const { t, tOptional } = await getI18n();
  const template = getIndustryTemplate(membership.industryTemplateId);
  const canManage = canManageConfig(membership.role);

  if (!template) {
    return (
      <p className="rounded-xl border border-border bg-surface px-4 py-8 text-sm text-muted">
        {t("settingsAi.noTemplate")}
      </p>
    );
  }

  const templateName = tOptional(template.nameKey ?? "") ?? template.name;

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
    label: tOptional(f.labelKey ?? "") ?? f.label,
    enabled: f.enabled,
    order: f.order,
    questionHint: flowHints.get(f.key) ?? templateFlowHints.get(f.key) ?? "",
    inFlow: templateFlowKeys.has(f.key),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("settingsAi.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {t("settingsAi.subtitle", { template: templateName })}
        </p>
        {!canManage ? (
          <p className="mt-2 inline-block rounded-md border border-border bg-background px-2 py-1 text-xs text-muted">
            {t("settingsAi.readonly")}
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
