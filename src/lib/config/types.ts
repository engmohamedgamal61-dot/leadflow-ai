/**
 * Configuration model for LeadFlow AI.
 *
 * LeadFlow is an **AI lead-automation platform**, not a real-estate app. An
 * industry (real estate, clinics, automotive, …) is *data* — an
 * {@link IndustryTemplate} — never branching logic. The AI engine, the
 * qualification flow and the scoring engine all consume an
 * {@link EffectiveConfig} produced by merging a template with an
 * organization's overrides.
 *
 *   IndustryTemplate  →  + OrganizationConfig overrides  →  EffectiveConfig
 */

// ── Lead fields ────────────────────────────────────────────────────────────

export type LeadFieldType =
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "date";

export interface LeadFieldOption {
  /** Canonical stored value. */
  value: string;
  label: string;
  /**
   * Alternative spellings/synonyms that normalize to this option's `value`
   * (e.g. "purchase" → "buy"). Matched case-insensitively.
   */
  aliases?: string[];
}

/**
 * A single piece of information a template wants to collect about a lead.
 * Field keys are arbitrary strings — real estate uses `budget` / `bedrooms`,
 * a clinic would use `service` / `appointment_date`, etc.
 */
export interface LeadFieldDefinition {
  key: string;
  label: string;
  type: LeadFieldType;
  required: boolean;
  enabled: boolean;
  /** Sort order for the qualification flow and any future UI. */
  order: number;
  description?: string;
  /** Allowed values when `type` is `"select"`. */
  options?: LeadFieldOption[];
  /** Guidance for the extraction model on how to normalize this field. */
  extractionHint?: string;
}

// ── Qualification flow ─────────────────────────────────────────────────────

/**
 * One step of the qualification conversation. Deliberately does NOT carry a
 * fixed question string — the AI generates a natural question from
 * `questionHint` and the surrounding conversation.
 */
export interface QualificationStep {
  fieldKey: string;
  order: number;
  required: boolean;
  /** Optional hint for the AI about what to ask; never a literal script. */
  questionHint?: string;
}

// ── Scoring ────────────────────────────────────────────────────────────────

/** Numeric threshold, evaluated highest-`min`-first. */
export interface ScoringTier {
  min: number;
  points: number;
}

export type ScoringClassifierId = "timeline";

/**
 * A deterministic rule that awards points for one field. The score is always
 * computed in application code — never by the model.
 */
export type ScoringRule =
  | {
      kind: "match";
      fieldKey: string;
      maxPoints: number;
      /** Exact value → points. */
      cases: Record<string, number>;
      /** Points when the field is missing or matches no case. */
      whenMissing: number;
    }
  | {
      kind: "presence";
      fieldKey: string;
      maxPoints: number;
      /** Points awarded when the field has a usable value. */
      points: number;
      whenMissing: number;
    }
  | {
      kind: "boolean";
      fieldKey: string;
      maxPoints: number;
      whenTrue: number;
      whenFalse: number;
      whenMissing: number;
    }
  | {
      kind: "numericThreshold";
      fieldKey: string;
      maxPoints: number;
      tiers: ScoringTier[];
      whenMissing: number;
    }
  | {
      kind: "bucket";
      fieldKey: string;
      maxPoints: number;
      /** Named deterministic classifier (see lead-scoring.ts). */
      classifier: ScoringClassifierId;
      /** Bucket id → points. */
      buckets: Record<string, number>;
      whenMissing: number;
    };

export interface TemperatureThresholds {
  /** score ≥ hot → HOT */
  hot: number;
  /** score ≥ warm → WARM, otherwise COLD */
  warm: number;
}

export interface ScoringConfig {
  rules: ScoringRule[];
  thresholds: TemperatureThresholds;
}

// ── AI behavior ────────────────────────────────────────────────────────────

export interface AiBehaviorConfig {
  /** One-line persona, e.g. "a warm, sharp sales assistant for a brokerage". */
  persona: string;
  /** What the assistant is trying to achieve in the conversation. */
  goal: string;
  tone: string;
  style: string;
  /** Languages the assistant should understand and mirror. */
  languages: string[];
  /** Hard rules the assistant must always follow. */
  rules: string[];
  /** Optional domain context (units, local vocabulary, …). */
  domainContext?: string;
}

// ── Industry template ──────────────────────────────────────────────────────

export interface IndustryTemplate {
  id: string;
  name: string;
  /** URL-safe identifier used to look the template up. */
  slug: string;
  description: string;
  leadFields: LeadFieldDefinition[];
  qualificationFlow: QualificationStep[];
  scoring: ScoringConfig;
  aiBehavior: AiBehaviorConfig;
}

// ── Organization overrides ─────────────────────────────────────────────────

export interface LeadFieldOverride {
  key: string;
  label?: string;
  required?: boolean;
  enabled?: boolean;
  order?: number;
  description?: string;
}

export interface QualificationStepOverride {
  fieldKey: string;
  order?: number;
  required?: boolean;
  questionHint?: string;
  /** Set `false` to drop this step from the flow. */
  enabled?: boolean;
}

export interface ScoringOverride {
  thresholds?: Partial<TemperatureThresholds>;
  /** Rules that replace (matched by `fieldKey`) or add to the template rules. */
  rules?: ScoringRule[];
  /** Field keys whose scoring rule should be removed. */
  removeRules?: string[];
}

export interface AiBehaviorOverride {
  persona?: string;
  goal?: string;
  tone?: string;
  style?: string;
  languages?: string[];
  /** Rules appended after the template's rules. */
  additionalRules?: string[];
  domainContext?: string;
}

/**
 * An organization's customization of an industry template. No persistence yet —
 * this is the shape a database row (or API payload) will take later.
 */
export interface OrganizationConfig {
  organizationId: string;
  /** Slug of the {@link IndustryTemplate} this organization is based on. */
  industryTemplateId: string;
  fieldOverrides?: LeadFieldOverride[];
  qualificationOverrides?: QualificationStepOverride[];
  scoringOverrides?: ScoringOverride;
  aiBehaviorOverrides?: AiBehaviorOverride;
}

// ── Effective configuration ────────────────────────────────────────────────

/**
 * The resolved configuration the engine actually runs on:
 * template defaults + organization overrides.
 */
export interface EffectiveConfig {
  templateSlug: string;
  organizationId: string | null;
  /** All fields, sorted by `order` (includes disabled ones). */
  leadFields: LeadFieldDefinition[];
  /** Steps for enabled fields only, sorted by `order`. */
  qualificationFlow: QualificationStep[];
  scoring: ScoringConfig;
  aiBehavior: AiBehaviorConfig;
}
