/**
 * The `organization_configs.config` blob: an organization's **overrides only**
 * (never a resolved EffectiveConfig). It is the persisted subset of
 * {@link OrganizationConfig} without the ids.
 *
 * This module is pure (no I/O) so it runs under `node --test`:
 *  - `parseStoredConfig`   — lenient: coerce a stored blob, drop anything
 *    unrecognised, so a corrupt row can never break the chat.
 *  - `validateStoredConfig` — strict: reject a *proposed* blob before saving.
 *  - `diff*`               — turn desired final values into the minimal
 *    override set, so the stored blob only ever holds real deltas.
 *
 * The merge itself is unchanged — it stays in `effective-config.ts`.
 */

import { resolveEffectiveConfig, enabledLeadFields } from "./effective-config.ts";
import { validateEffectiveConfig, type ValidationResult } from "./validate.ts";
import { getIndustryTemplate, DEFAULT_INDUSTRY_SLUG } from "./registry.ts";
import type {
  AiBehaviorConfig,
  AiBehaviorOverride,
  IndustryTemplate,
  LeadFieldOverride,
  OrganizationConfig,
  QualificationStepOverride,
  ScoringOverride,
  TemperatureThresholds,
} from "./types.ts";

export interface StoredOrgConfig {
  fieldOverrides?: LeadFieldOverride[];
  qualificationOverrides?: QualificationStepOverride[];
  scoringOverrides?: ScoringOverride;
  aiBehaviorOverrides?: AiBehaviorOverride;
}

// ── limits (keep the prompt / config from being abused) ────────────────────

export const LIMITS = {
  shortText: 400, // persona, goal, tone, style
  domainContext: 1200,
  rule: 400,
  language: 200,
  label: 80,
  questionHint: 300,
  maxRules: 40,
  maxLanguages: 20,
  order: { min: 0, max: 100000 },
  threshold: { min: 0, max: 100 },
} as const;

// ── small guards ──────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function boolOrUndef(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function intOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;
}
function cleanLines(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => str(x)?.trim() ?? "").filter(Boolean);
  }
  if (typeof v === "string") {
    return v.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  return [];
}

// ── parse (lenient) ───────────────────────────────────────────────────────

export function parseStoredConfig(raw: unknown): StoredOrgConfig {
  if (!isObject(raw)) return {};
  const out: StoredOrgConfig = {};

  if (Array.isArray(raw.fieldOverrides)) {
    const fields = raw.fieldOverrides
      .filter(isObject)
      .map((o): LeadFieldOverride | null => {
        const key = str(o.key)?.trim();
        if (!key) return null;
        const ov: LeadFieldOverride = { key };
        if (str(o.label) !== undefined) ov.label = String(o.label).slice(0, LIMITS.label);
        if (boolOrUndef(o.required) !== undefined) ov.required = o.required as boolean;
        if (boolOrUndef(o.enabled) !== undefined) ov.enabled = o.enabled as boolean;
        if (intOrUndef(o.order) !== undefined) ov.order = intOrUndef(o.order);
        if (str(o.description) !== undefined) {
          ov.description = String(o.description).slice(0, LIMITS.questionHint);
        }
        return ov;
      })
      .filter((x): x is LeadFieldOverride => x !== null);
    if (fields.length) out.fieldOverrides = fields;
  }

  if (Array.isArray(raw.qualificationOverrides)) {
    const steps = raw.qualificationOverrides
      .filter(isObject)
      .map((o): QualificationStepOverride | null => {
        const fieldKey = str(o.fieldKey)?.trim();
        if (!fieldKey) return null;
        const ov: QualificationStepOverride = { fieldKey };
        if (intOrUndef(o.order) !== undefined) ov.order = intOrUndef(o.order);
        if (boolOrUndef(o.required) !== undefined) ov.required = o.required as boolean;
        if (boolOrUndef(o.enabled) !== undefined) ov.enabled = o.enabled as boolean;
        if (str(o.questionHint) !== undefined) {
          ov.questionHint = String(o.questionHint).slice(0, LIMITS.questionHint);
        }
        return ov;
      })
      .filter((x): x is QualificationStepOverride => x !== null);
    if (steps.length) out.qualificationOverrides = steps;
  }

  if (isObject(raw.scoringOverrides)) {
    const so: ScoringOverride = {};
    const t = raw.scoringOverrides.thresholds;
    if (isObject(t)) {
      const th: Partial<TemperatureThresholds> = {};
      if (intOrUndef(t.hot) !== undefined) th.hot = intOrUndef(t.hot);
      if (intOrUndef(t.warm) !== undefined) th.warm = intOrUndef(t.warm);
      if (th.hot !== undefined || th.warm !== undefined) so.thresholds = th;
    }
    // rules / removeRules are carried through verbatim (not editable in the UI
    // yet); the strict validator still checks them against the schema on save.
    if (Array.isArray(raw.scoringOverrides.rules)) {
      so.rules = raw.scoringOverrides.rules as ScoringOverride["rules"];
    }
    if (Array.isArray(raw.scoringOverrides.removeRules)) {
      so.removeRules = raw.scoringOverrides.removeRules.filter(
        (k): k is string => typeof k === "string",
      );
    }
    if (so.thresholds || so.rules || so.removeRules) out.scoringOverrides = so;
  }

  if (isObject(raw.aiBehaviorOverrides)) {
    const a = raw.aiBehaviorOverrides;
    const ov: AiBehaviorOverride = {};
    for (const k of ["persona", "goal", "tone", "style", "domainContext"] as const) {
      const s = str(a[k])?.trim();
      if (s) {
        ov[k] = s.slice(0, k === "domainContext" ? LIMITS.domainContext : LIMITS.shortText);
      }
    }
    const languages = cleanLines(a.languages)
      .slice(0, LIMITS.maxLanguages)
      .map((l) => l.slice(0, LIMITS.language));
    if (languages.length) ov.languages = languages;
    const additionalRules = cleanLines(a.additionalRules)
      .slice(0, LIMITS.maxRules)
      .map((r) => r.slice(0, LIMITS.rule));
    if (additionalRules.length) ov.additionalRules = additionalRules;
    if (Object.keys(ov).length) out.aiBehaviorOverrides = ov;
  }

  return out;
}

// ── OrganizationConfig assembly ───────────────────────────────────────────

export function toOrganizationConfig(
  organizationId: string,
  industryTemplateId: string,
  stored: StoredOrgConfig,
): OrganizationConfig {
  return { organizationId, industryTemplateId, ...stored };
}

/** Merge a stored blob with its industry template into an EffectiveConfig. */
export function effectiveConfigFromStored(
  organizationId: string,
  industryTemplateId: string,
  stored: StoredOrgConfig,
) {
  const template =
    getIndustryTemplate(industryTemplateId) ??
    getIndustryTemplate(DEFAULT_INDUSTRY_SLUG)!;
  return resolveEffectiveConfig(
    template,
    toOrganizationConfig(organizationId, template.slug, stored),
  );
}

// ── validate (strict, pre-save) ───────────────────────────────────────────

export function validateStoredConfig(
  stored: StoredOrgConfig,
  template: IndustryTemplate,
): ValidationResult {
  const errors: string[] = [];
  const fieldKeys = new Set(template.leadFields.map((f) => f.key));

  for (const o of stored.fieldOverrides ?? []) {
    if (!fieldKeys.has(o.key)) {
      errors.push(`field override references unknown field "${o.key}"`);
    }
    if (o.label !== undefined && (o.label.length === 0 || o.label.length > LIMITS.label)) {
      errors.push(`field "${o.key}" label must be 1-${LIMITS.label} characters`);
    }
    if (o.order !== undefined && (o.order < LIMITS.order.min || o.order > LIMITS.order.max)) {
      errors.push(`field "${o.key}" order is out of range`);
    }
    if (o.description !== undefined && o.description.length > LIMITS.questionHint) {
      errors.push(`field "${o.key}" description is too long`);
    }
  }

  for (const o of stored.qualificationOverrides ?? []) {
    if (!fieldKeys.has(o.fieldKey)) {
      errors.push(`qualification override references unknown field "${o.fieldKey}"`);
    }
    if (o.order !== undefined && (o.order < LIMITS.order.min || o.order > LIMITS.order.max)) {
      errors.push(`qualification "${o.fieldKey}" order is out of range`);
    }
    if (o.questionHint !== undefined && o.questionHint.length > LIMITS.questionHint) {
      errors.push(`qualification "${o.fieldKey}" hint is too long`);
    }
  }

  const th = stored.scoringOverrides?.thresholds;
  if (th) {
    for (const k of ["hot", "warm"] as const) {
      const v = th[k];
      if (v !== undefined && (v < LIMITS.threshold.min || v > LIMITS.threshold.max)) {
        errors.push(`scoring threshold "${k}" must be 0-100`);
      }
    }
  }

  const ai = stored.aiBehaviorOverrides;
  if (ai) {
    for (const k of ["persona", "goal", "tone", "style"] as const) {
      if (ai[k] !== undefined && (ai[k]!.length === 0 || ai[k]!.length > LIMITS.shortText)) {
        errors.push(`aiBehavior "${k}" must be 1-${LIMITS.shortText} characters`);
      }
    }
    if (ai.domainContext !== undefined && ai.domainContext.length > LIMITS.domainContext) {
      errors.push("aiBehavior domainContext is too long");
    }
    if (ai.languages !== undefined) {
      if (!Array.isArray(ai.languages) || ai.languages.length === 0) {
        errors.push("aiBehavior languages must be a non-empty list");
      } else if (ai.languages.length > LIMITS.maxLanguages) {
        errors.push(`aiBehavior: at most ${LIMITS.maxLanguages} languages`);
      }
    }
    if (ai.additionalRules !== undefined) {
      if (!Array.isArray(ai.additionalRules)) {
        errors.push("aiBehavior additionalRules must be a list");
      } else if (ai.additionalRules.length > LIMITS.maxRules) {
        errors.push(`aiBehavior: at most ${LIMITS.maxRules} additional rules`);
      } else if (ai.additionalRules.some((r) => typeof r !== "string" || r.length > LIMITS.rule)) {
        errors.push("aiBehavior: a rule is empty or too long");
      }
    }
  }

  // Merge and run the same schema checks the engine relies on (scoring ≤ 100,
  // rules target real fields, hot ≥ warm), plus "don't break the flow".
  if (errors.length === 0) {
    const merged = resolveEffectiveConfig(
      template,
      toOrganizationConfig("_validate_", template.slug, stored),
    );
    const eff = validateEffectiveConfig(merged);
    errors.push(...eff.errors);
    if (enabledLeadFields(merged).length === 0) {
      errors.push("at least one qualification field must stay enabled");
    }
    if (merged.qualificationFlow.length === 0) {
      errors.push("the qualification flow cannot be empty");
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── diff: desired final values → minimal overrides ────────────────────────

export interface AiBehaviorForm {
  persona: string;
  goal: string;
  tone: string;
  style: string;
  domainContext: string;
  languages: string[];
  additionalRules: string[];
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function diffAiBehavior(
  base: AiBehaviorConfig,
  form: AiBehaviorForm,
): AiBehaviorOverride | undefined {
  const ov: AiBehaviorOverride = {};
  for (const k of ["persona", "goal", "tone", "style"] as const) {
    const v = form[k].trim();
    if (v && v !== base[k]) ov[k] = v;
  }
  const dc = form.domainContext.trim();
  if (dc !== (base.domainContext ?? "").trim()) {
    if (dc) ov.domainContext = dc;
  }
  const langs = form.languages.map((l) => l.trim()).filter(Boolean);
  if (langs.length && !sameList(langs, base.languages)) ov.languages = langs;
  const rules = form.additionalRules.map((r) => r.trim()).filter(Boolean);
  if (rules.length) ov.additionalRules = rules;
  return Object.keys(ov).length ? ov : undefined;
}

export interface FieldForm {
  key: string;
  enabled: boolean;
  order: number;
  questionHint: string;
}

export interface QualificationDiff {
  fieldOverrides: LeadFieldOverride[];
  qualificationOverrides: QualificationStepOverride[];
}

/**
 * One row per template field. `enabled` + `order` land on `fieldOverrides`
 * (which the merge uses for both the field list and — via enabled keys — the
 * flow); `order` + `questionHint` also land on `qualificationOverrides` so the
 * flow itself re-sorts and re-hints.
 */
export function diffQualification(
  template: IndustryTemplate,
  rows: FieldForm[],
): QualificationDiff {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const stepByKey = new Map(
    template.qualificationFlow.map((s) => [s.fieldKey, s]),
  );
  const fieldOverrides: LeadFieldOverride[] = [];
  const qualificationOverrides: QualificationStepOverride[] = [];

  for (const field of template.leadFields) {
    const row = byKey.get(field.key);
    if (!row) continue;
    const fo: LeadFieldOverride = { key: field.key };
    if (row.enabled !== field.enabled) fo.enabled = row.enabled;
    if (Number.isFinite(row.order) && row.order !== field.order) fo.order = row.order;
    if (Object.keys(fo).length > 1) fieldOverrides.push(fo);

    const step = stepByKey.get(field.key);
    const qo: QualificationStepOverride = { fieldKey: field.key };
    if (step) {
      if (Number.isFinite(row.order) && row.order !== step.order) qo.order = row.order;
      const hint = row.questionHint.trim();
      if (hint && hint !== (step.questionHint ?? "")) qo.questionHint = hint;
      // a disabled field also drops its flow step (belt & braces with fieldOverrides)
      if (!row.enabled) qo.enabled = false;
    }
    if (Object.keys(qo).length > 1) qualificationOverrides.push(qo);
  }

  return { fieldOverrides, qualificationOverrides };
}

export function diffScoringThresholds(
  base: TemperatureThresholds,
  form: { hot: number; warm: number },
): Partial<TemperatureThresholds> | undefined {
  const th: Partial<TemperatureThresholds> = {};
  if (Number.isFinite(form.hot) && form.hot !== base.hot) th.hot = form.hot;
  if (Number.isFinite(form.warm) && form.warm !== base.warm) th.warm = form.warm;
  return Object.keys(th).length ? th : undefined;
}

/** Strip empty containers so the stored blob stays minimal. */
export function compactStoredConfig(stored: StoredOrgConfig): StoredOrgConfig {
  const out: StoredOrgConfig = {};
  if (stored.fieldOverrides?.length) out.fieldOverrides = stored.fieldOverrides;
  if (stored.qualificationOverrides?.length) {
    out.qualificationOverrides = stored.qualificationOverrides;
  }
  const so = stored.scoringOverrides;
  if (so && (so.thresholds || so.rules?.length || so.removeRules?.length)) {
    out.scoringOverrides = so;
  }
  if (stored.aiBehaviorOverrides && Object.keys(stored.aiBehaviorOverrides).length) {
    out.aiBehaviorOverrides = stored.aiBehaviorOverrides;
  }
  return out;
}
