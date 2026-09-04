/**
 * Deterministic qualification-completion check.
 *
 * "Is this lead qualified?" is decided ENTIRELY in app code from the enabled
 * qualification fields, the extracted {@link LeadData}, and the
 * {@link EffectiveConfig} — never from Claude's prose. The AI decision layer
 * may only *propose* actions; whether qualification is actually complete is
 * this function's job.
 *
 * `getLeadFieldValue` is imported by relative path so this module (and its
 * test) run under `node --test`.
 */

import { getLeadFieldValue, type LeadData } from "../../types/chat.ts";
import type { EffectiveConfig } from "@/lib/config";

/** A field "has a value" if the lead carries a non-empty, non-null value. */
export function hasFieldValue(lead: LeadData, fieldKey: string): boolean {
  const value = getLeadFieldValue(lead, fieldKey);
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export interface QualificationProgress {
  /** Required qualification steps (enabled fields marked `required`). */
  requiredTotal: number;
  requiredFilled: number;
  /** Every enabled qualification step. */
  total: number;
  filled: number;
  complete: boolean;
}

/**
 * Progress toward qualification.
 *
 * `complete` when every **required** enabled qualification step has a value.
 * If the flow has no required steps, it is complete once every enabled step
 * has a value (and there is at least one step).
 */
export function qualificationProgress(
  lead: LeadData,
  config: EffectiveConfig,
): QualificationProgress {
  const flow = Array.isArray(config?.qualificationFlow)
    ? config.qualificationFlow
    : [];

  const required = flow.filter((step) => step.required);
  const requiredFilled = required.filter((step) =>
    hasFieldValue(lead, step.fieldKey),
  ).length;
  const filled = flow.filter((step) =>
    hasFieldValue(lead, step.fieldKey),
  ).length;

  const complete =
    flow.length > 0 &&
    (required.length > 0
      ? requiredFilled === required.length
      : filled === flow.length);

  return {
    requiredTotal: required.length,
    requiredFilled,
    total: flow.length,
    filled,
    complete,
  };
}

export function isQualificationComplete(
  lead: LeadData,
  config: EffectiveConfig,
): boolean {
  return qualificationProgress(lead, config).complete;
}
