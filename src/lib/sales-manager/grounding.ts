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

/**
 * How trustworthy a result is as a statement of the underlying fact:
 *  - `exact`   — a direct, complete count / row set. May be stated plainly.
 *  - `partial` — capped / sampled. The true value may be larger; the answer
 *                MUST disclose this ("at least N", "top N of M", "based on a
 *                sample").
 *  - `proxy`   — a stand-in signal for the thing asked (e.g. `updated_at` for
 *                "contacted"). The answer MUST describe the signal, not the
 *                thing ("no recent lead-record update", not "not contacted").
 */
export type ResultAccuracy = "exact" | "partial" | "proxy";

export interface OperationOutcome {
  type: OperationType;
  /** Human-readable summary of what was asked (filters, range, sort…). */
  label: string;
  /** Compact structured facts — the ONLY things the answer may state. */
  data: Record<string, unknown>;
  /** True when this operation found nothing (0 rows / all-zero counts). */
  empty: boolean;
  /** Data-quality classification (default `exact`). */
  accuracy: ResultAccuracy;
  /** Caveats the answer must surface (caps, sampling, proxy semantics…). */
  warnings?: string[];
  /** Interpretations the executor made that the answer must not hide. */
  assumptions?: string[];
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

export interface GroundingResult {
  operation: OperationType;
  label: string;
  data: Record<string, unknown>;
  accuracy: ResultAccuracy;
  warnings: string[];
  assumptions: string[];
}

export interface GroundingContext {
  question: string;
  now: string;
  results: GroundingResult[];
  /** True when EVERY operation came back empty. */
  allEmpty: boolean;
  /** True when any result is capped/sampled/proxied — the answer must disclose. */
  hasInexact: boolean;
}

export function buildGroundingContext(
  question: string,
  outcomes: OperationOutcome[],
  now: Date,
): GroundingContext {
  const results: GroundingResult[] = outcomes.map((o) => ({
    operation: o.type,
    label: o.label,
    data: o.data,
    accuracy: o.accuracy ?? "exact",
    warnings: o.warnings ?? [],
    assumptions: o.assumptions ?? [],
  }));
  return {
    question,
    now: now.toISOString(),
    results,
    allEmpty: outcomes.length > 0 && outcomes.every((o) => o.empty),
    hasInexact: results.some(
      (r) => r.accuracy !== "exact" || r.warnings.length > 0 || r.assumptions.length > 0,
    ),
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
const ACCURACY_NOTE: Record<ResultAccuracy, string> = {
  exact: "EXACT — this is a complete, direct count/list; you may state it plainly.",
  partial:
    "PARTIAL — capped or sampled. The true figure may be higher. Do NOT state it as an exact number; say \"at least N\" / \"the top N of M\" / \"based on a sample\".",
  proxy:
    "PROXY — this is a stand-in signal, NOT the thing asked. Describe the signal itself; do not claim the underlying fact.",
};

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
    lines.push(`  accuracy: ${ACCURACY_NOTE[r.accuracy]}`);
    for (const w of r.warnings) lines.push(`  WARNING: ${w}`);
    for (const a of r.assumptions) lines.push(`  ASSUMPTION (disclose this): ${a}`);
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

  if (ctx.hasInexact) {
    lines.push("");
    lines.push(
      "REMINDER: at least one result above is PARTIAL or PROXY or carries a WARNING/ASSUMPTION. Your answer must disclose every such limitation in plain language — never present partial or proxy data as an exact fact.",
    );
  }

  return lines.join("\n");
}
