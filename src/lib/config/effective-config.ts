import type {
  AiBehaviorConfig,
  EffectiveConfig,
  IndustryTemplate,
  LeadFieldDefinition,
  OrganizationConfig,
  QualificationStep,
  ScoringConfig,
} from "./types.ts";

function byOrder<T extends { order: number }>(a: T, b: T): number {
  return a.order - b.order;
}

function mergeLeadFields(
  template: IndustryTemplate,
  org: OrganizationConfig | null,
): LeadFieldDefinition[] {
  const overrides = new Map(
    (org?.fieldOverrides ?? []).map((o) => [o.key, o]),
  );

  const merged = template.leadFields.map((field) => {
    const override = overrides.get(field.key);
    if (!override) return { ...field };
    return {
      ...field,
      label: override.label ?? field.label,
      required: override.required ?? field.required,
      enabled: override.enabled ?? field.enabled,
      order: override.order ?? field.order,
      description: override.description ?? field.description,
    };
  });

  return merged.sort(byOrder);
}

function mergeQualificationFlow(
  template: IndustryTemplate,
  org: OrganizationConfig | null,
  enabledFieldKeys: Set<string>,
): QualificationStep[] {
  const overrides = new Map(
    (org?.qualificationOverrides ?? []).map((o) => [o.fieldKey, o]),
  );

  return template.qualificationFlow
    .map((step) => {
      const override = overrides.get(step.fieldKey);
      if (!override) return { ...step };
      return {
        ...step,
        order: override.order ?? step.order,
        required: override.required ?? step.required,
        questionHint: override.questionHint ?? step.questionHint,
      };
    })
    .filter((step) => {
      if (!enabledFieldKeys.has(step.fieldKey)) return false;
      const override = overrides.get(step.fieldKey);
      return override?.enabled !== false;
    })
    .sort(byOrder);
}

function mergeScoring(
  template: IndustryTemplate,
  org: OrganizationConfig | null,
): ScoringConfig {
  const scoringOverride = org?.scoringOverrides;
  const rulesByField = new Map(
    template.scoring.rules.map((rule) => [rule.fieldKey, rule]),
  );

  for (const key of scoringOverride?.removeRules ?? []) {
    rulesByField.delete(key);
  }
  for (const rule of scoringOverride?.rules ?? []) {
    rulesByField.set(rule.fieldKey, rule);
  }

  return {
    rules: [...rulesByField.values()],
    thresholds: {
      hot: scoringOverride?.thresholds?.hot ?? template.scoring.thresholds.hot,
      warm:
        scoringOverride?.thresholds?.warm ?? template.scoring.thresholds.warm,
    },
  };
}

function mergeAiBehavior(
  template: IndustryTemplate,
  org: OrganizationConfig | null,
): AiBehaviorConfig {
  const override = org?.aiBehaviorOverrides;
  const base = template.aiBehavior;
  return {
    persona: override?.persona ?? base.persona,
    goal: override?.goal ?? base.goal,
    tone: override?.tone ?? base.tone,
    style: override?.style ?? base.style,
    languages: override?.languages ?? base.languages,
    rules: [...base.rules, ...(override?.additionalRules ?? [])],
    domainContext: override?.domainContext ?? base.domainContext,
  };
}

/**
 * Merge an industry template with an optional organization override into the
 * configuration the engine actually runs on.
 *
 *   template defaults  +  organization overrides  =  effective configuration
 *
 * Pure and defensive: a `null` / partial override yields the plain template.
 */
export function resolveEffectiveConfig(
  template: IndustryTemplate,
  org: OrganizationConfig | null = null,
): EffectiveConfig {
  const leadFields = mergeLeadFields(template, org);
  const enabledFieldKeys = new Set(
    leadFields.filter((f) => f.enabled).map((f) => f.key),
  );

  return {
    templateSlug: template.slug,
    organizationId: org?.organizationId ?? null,
    leadFields,
    qualificationFlow: mergeQualificationFlow(template, org, enabledFieldKeys),
    scoring: mergeScoring(template, org),
    aiBehavior: mergeAiBehavior(template, org),
  };
}

/** Fields that are enabled, in flow order. */
export function enabledLeadFields(
  config: EffectiveConfig,
): LeadFieldDefinition[] {
  return config.leadFields.filter((field) => field.enabled);
}
