import type {
  EffectiveConfig,
  IndustryTemplate,
  ScoringConfig,
} from "./types.ts";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const FIELD_TYPES = new Set([
  "text",
  "number",
  "boolean",
  "select",
  "date",
]);

function validateScoring(
  scoring: ScoringConfig,
  fieldKeys: Set<string>,
  errors: string[],
): void {
  if (!scoring || !Array.isArray(scoring.rules)) {
    errors.push("scoring.rules must be an array");
    return;
  }

  let maxTotal = 0;
  for (const rule of scoring.rules) {
    if (!rule || typeof rule !== "object") {
      errors.push("scoring rule must be an object");
      continue;
    }
    if (!fieldKeys.has(rule.fieldKey)) {
      errors.push(`scoring rule references unknown field "${rule.fieldKey}"`);
    }
    if (typeof rule.maxPoints !== "number" || rule.maxPoints < 0) {
      errors.push(`scoring rule "${rule.fieldKey}" has invalid maxPoints`);
    } else {
      maxTotal += rule.maxPoints;
    }
    if (rule.kind === "numericThreshold" && !Array.isArray(rule.tiers)) {
      errors.push(`scoring rule "${rule.fieldKey}" is missing tiers`);
    }
    if (
      rule.kind === "bucket" &&
      (!rule.buckets || typeof rule.buckets !== "object")
    ) {
      errors.push(`scoring rule "${rule.fieldKey}" is missing buckets`);
    }
    if (rule.kind === "match" && (!rule.cases || typeof rule.cases !== "object")) {
      errors.push(`scoring rule "${rule.fieldKey}" is missing cases`);
    }
  }

  if (maxTotal > 100) {
    errors.push(`scoring rules can award ${maxTotal} points (> 100)`);
  }

  const { thresholds } = scoring;
  if (
    !thresholds ||
    typeof thresholds.hot !== "number" ||
    typeof thresholds.warm !== "number" ||
    thresholds.hot < thresholds.warm
  ) {
    errors.push("scoring.thresholds must have hot >= warm");
  }
}

/**
 * Validate an industry template's internal consistency: every flow step and
 * scoring rule points at a real field, field metadata is well-formed, and the
 * scoring model cannot exceed 100 points. Never throws.
 */
export function validateIndustryTemplate(
  template: IndustryTemplate,
): ValidationResult {
  const errors: string[] = [];

  try {
    if (!template || typeof template !== "object") {
      return { valid: false, errors: ["template is not an object"] };
    }
    for (const key of ["id", "name", "slug", "description"] as const) {
      if (typeof template[key] !== "string" || template[key].length === 0) {
        errors.push(`template.${key} is required`);
      }
    }

    if (!Array.isArray(template.leadFields) || template.leadFields.length === 0) {
      errors.push("template.leadFields must be a non-empty array");
      return { valid: errors.length === 0, errors };
    }

    const fieldKeys = new Set<string>();
    for (const field of template.leadFields) {
      if (!field || typeof field.key !== "string" || field.key.length === 0) {
        errors.push("lead field is missing a key");
        continue;
      }
      if (fieldKeys.has(field.key)) {
        errors.push(`duplicate lead field key "${field.key}"`);
      }
      fieldKeys.add(field.key);
      if (!FIELD_TYPES.has(field.type)) {
        errors.push(`lead field "${field.key}" has invalid type "${field.type}"`);
      }
      if (typeof field.order !== "number") {
        errors.push(`lead field "${field.key}" is missing an order`);
      }
      if (
        field.type === "select" &&
        field.options !== undefined &&
        !Array.isArray(field.options)
      ) {
        errors.push(`lead field "${field.key}" options must be an array`);
      }
    }

    if (!Array.isArray(template.qualificationFlow)) {
      errors.push("template.qualificationFlow must be an array");
    } else {
      for (const step of template.qualificationFlow) {
        if (!step || !fieldKeys.has(step.fieldKey)) {
          errors.push(
            `qualification step references unknown field "${step?.fieldKey}"`,
          );
        }
        if (typeof step?.order !== "number") {
          errors.push(
            `qualification step "${step?.fieldKey}" is missing an order`,
          );
        }
      }
    }

    validateScoring(template.scoring, fieldKeys, errors);

    if (!template.aiBehavior || typeof template.aiBehavior !== "object") {
      errors.push("template.aiBehavior is required");
    } else {
      if (typeof template.aiBehavior.persona !== "string") {
        errors.push("aiBehavior.persona is required");
      }
      if (!Array.isArray(template.aiBehavior.rules)) {
        errors.push("aiBehavior.rules must be an array");
      }
    }
  } catch (error) {
    errors.push(
      `unexpected validation error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/** Validate a resolved effective config (subset of the template checks). */
export function validateEffectiveConfig(
  config: EffectiveConfig,
): ValidationResult {
  const errors: string[] = [];
  try {
    const fieldKeys = new Set(config.leadFields.map((f) => f.key));
    for (const step of config.qualificationFlow) {
      if (!fieldKeys.has(step.fieldKey)) {
        errors.push(`flow step references unknown field "${step.fieldKey}"`);
      }
    }
    validateScoring(config.scoring, fieldKeys, errors);
  } catch (error) {
    errors.push(
      `unexpected validation error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { valid: errors.length === 0, errors };
}
