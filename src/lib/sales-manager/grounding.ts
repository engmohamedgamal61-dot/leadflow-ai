/**
 * Ask LeadFlow — the GroundingContext the final answer call is allowed to use.
 *
 * Pure. After every allowlisted operation has run against tenant-scoped data,
 * its structured result is collected here. `renderGroundingText` turns the
 * context into a compact, bounded block for the model, which is instructed to
 * use ONLY these facts — never the conversation, never prior knowledge.
 *
 * Lead / appointment lines carry the display name only, never an internal id.
 */

import type { OperationType } from "./plan.ts";
import type {
  ActivityLike,
  AppointmentCard,
  LeadCard,
  MetricValue,
} from "./ranking.ts";

export interface OperationOutcome {
  type: OperationType;
  /** Human-readable summary of what was asked (filters, range, sort…). */
  label: string;
  /** Compact structured facts — the ONLY things the answer may state. */
  data: Record<string, unknown>;
  /** True when this operation found nothing (0 rows / all-zero counts). */
  empty: boolean;
}

/** UI cards produced by an operation, merged across a whole plan for the panel. */
export interface GroundedView {
  metrics: MetricValue[];
  leads: LeadCard[];
  appointments: AppointmentCard[];
  activity: ActivityLike[];
}

export const emptyView = (): GroundedView => ({
  metrics: [],
  leads: [],
  appointments: [],
  activity: [],
});

export type ExecutedOperation = OperationOutcome & { view: GroundedView };

/** Merge every operation's UI cards into one bounded view for the panel. */
export function mergeViews(ops: ExecutedOperation[]): GroundedView {
  const view = emptyView();
  const seenLeads = new Set<string>();
  const seenAppts = new Set<string>();
  for (const op of ops) {
    for (const m of op.view.metrics) view.metrics.push(m);
    for (const l of op.view.leads) {
      if (l.id && seenLeads.has(l.id)) continue;
      if (l.id) seenLeads.add(l.id);
      view.leads.push(l);
    }
    for (const a of op.view.appointments) {
      if (seenAppts.has(a.id)) continue;
      seenAppts.add(a.id);
      view.appointments.push(a);
    }
    for (const e of op.view.activity) view.activity.push(e);
  }
  view.metrics = view.metrics.slice(0, 12);
  view.leads = view.leads.slice(0, 12);
  view.appointments = view.appointments.slice(0, 12);
  view.activity = view.activity.slice(0, 10);
  return view;
}

export interface GroundingContext {
  question: string;
  now: string;
  results: { operation: OperationType; label: string; data: Record<string, unknown> }[];
  /** True when EVERY operation came back empty. */
  allEmpty: boolean;
}

export function buildGroundingContext(
  question: string,
  outcomes: OperationOutcome[],
  now: Date,
): GroundingContext {
  return {
    question,
    now: now.toISOString(),
    results: outcomes.map((o) => ({
      operation: o.type,
      label: o.label,
      data: o.data,
    })),
    allEmpty: outcomes.length > 0 && outcomes.every((o) => o.empty),
  };
}

function renderValue(value: unknown, indent: string): string[] {
  if (value === null || value === undefined) return [`${indent}(none)`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}(empty)`];
    const lines: string[] = [];
    for (const item of value) {
      if (item && typeof item === "object") {
        const parts = Object.entries(item as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${scalar(v)}`)
          .join(", ");
        lines.push(`${indent}- ${parts}`);
      } else {
        lines.push(`${indent}- ${scalar(item)}`);
      }
    }
    return lines;
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${indent}${k}: ${scalar(v)}`,
    );
  }
  return [`${indent}${scalar(value)}`];
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

/**
 * Compact, bounded plain-text rendering of the context for the model.
 * Deterministic (stable key order per operation builder).
 */
export function renderGroundingText(ctx: GroundingContext): string {
  const lines: string[] = [];
  lines.push(`QUESTION: ${ctx.question}`);
  lines.push(`NOW: ${ctx.now} (UTC)`);
  lines.push("");
  lines.push("DATA (the only facts you may use):");

  if (ctx.results.length === 0) {
    lines.push("(no operations were run)");
  }

  ctx.results.forEach((r, i) => {
    lines.push("");
    lines.push(`[${i + 1}] ${r.operation} — ${r.label}`);
    for (const [key, value] of Object.entries(r.data)) {
      const rendered = renderValue(value, "    ");
      if (rendered.length === 1) {
        lines.push(`  ${key}: ${rendered[0].trimStart()}`);
      } else {
        lines.push(`  ${key}:`);
        lines.push(...rendered);
      }
    }
  });

  return lines.join("\n");
}
