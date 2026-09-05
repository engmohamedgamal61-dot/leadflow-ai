"use client";

import { useI18n } from "@/i18n/client";
import { humanizeKey } from "@/lib/leads/lead-view";

const TEMPERATURE_STYLE: Record<string, string> = {
  hot: "bg-rose-500/15 text-rose-700 ring-1 ring-inset ring-rose-500/30",
  warm: "bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30",
  cold: "bg-sky-500/15 text-sky-700 ring-1 ring-inset ring-sky-500/30",
};

export function TemperatureBadge({ value }: { value: string }) {
  const { tOptional } = useI18n();
  const key = value.toLowerCase();
  const label = tOptional(`temperatures.${key}`) ?? key;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
        TEMPERATURE_STYLE[key] ??
        "bg-border/40 text-muted ring-1 ring-inset ring-border"
      }`}
    >
      {label}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  new: "bg-border/50 text-muted",
  contacted: "bg-sky-500/10 text-sky-700",
  qualified: "bg-accent/15 text-foreground",
  appointment: "bg-violet-500/15 text-violet-700",
  won: "bg-emerald-500/15 text-emerald-700",
  lost: "bg-rose-500/10 text-rose-700",
  archived: "bg-border/40 text-muted/70",
};

export function StatusBadge({ value }: { value: string }) {
  const { tOptional } = useI18n();
  const key = value.toLowerCase();
  const label = tOptional(`statuses.${key}`) ?? humanizeKey(key);
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
        STATUS_STYLE[key] ?? "bg-border/40 text-muted"
      }`}
    >
      {label}
    </span>
  );
}

const RISK_STYLE: Record<string, string> = {
  needs_attention:
    "bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30",
  at_risk: "bg-rose-500/15 text-rose-700 ring-1 ring-inset ring-rose-500/30",
  none: "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20",
};

/** Renders a `RiskLevel` from `lib/leads/insights.ts` ("needs_attention" | "at_risk" | "none"). */
export function RiskBadge({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
        RISK_STYLE[value] ?? "bg-border/40 text-muted ring-1 ring-inset ring-border"
      }`}
    >
      {t(`insights.riskLevels.${value}`)}
    </span>
  );
}

/** Renders a `NextBestAction` from `lib/leads/insights.ts` (e.g. "call_now", "follow_up"). */
export function ActionBadge({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center rounded-md bg-border/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
      {t(`insights.actions.${value}`)}
    </span>
  );
}

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-rose-500/15 text-rose-700 ring-1 ring-inset ring-rose-500/30",
  medium: "bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30",
  low: "bg-border/40 text-muted ring-1 ring-inset ring-border",
};

/** Renders a `RecoveryPriority` from `lib/leads/recovery.ts` ("high" | "medium" | "low"). */
export function PriorityBadge({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
        PRIORITY_STYLE[value] ?? "bg-border/40 text-muted ring-1 ring-inset ring-border"
      }`}
    >
      {t(`recovery.priorities.${value}`)}
    </span>
  );
}

const OUTCOME_STYLE: Record<string, string> = {
  pending: "bg-border/50 text-muted",
  contacted: "bg-sky-500/10 text-sky-700",
  recovered: "bg-violet-500/15 text-violet-700",
  converted: "bg-emerald-500/15 text-emerald-700",
  no_response: "bg-rose-500/10 text-rose-700",
};

/** Renders a `RecoveryOutcome` from `lib/leads/recovery.ts`. */
export function OutcomeBadge({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
        OUTCOME_STYLE[value] ?? "bg-border/40 text-muted"
      }`}
    >
      {t(`recovery.outcomes.${value}`)}
    </span>
  );
}
