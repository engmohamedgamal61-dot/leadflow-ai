"use client";

import { useMemo, useState } from "react";
import { LEAD_FIELD_KEYS, type LeadData } from "@/types/chat";
import { getEffectiveConfig } from "@/lib/config";
import {
  calculateLeadScore,
  maxScore,
  scoreWeights,
  type LeadTemperature,
} from "@/lib/lead-scoring";

interface LeadDebugPanelProps {
  lead: LeadData;
}

const TEMPERATURE_STYLES: Record<
  LeadTemperature,
  { text: string; bar: string; badge: string }
> = {
  HOT: {
    text: "text-rose-300",
    bar: "bg-rose-400",
    badge: "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30",
  },
  WARM: {
    text: "text-amber-300",
    bar: "bg-amber-400",
    badge: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30",
  },
  COLD: {
    text: "text-sky-300",
    bar: "bg-sky-400",
    badge: "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30",
  },
};

/**
 * Development-only inspector for the structured lead data and its deterministic
 * score. Hidden entirely in production builds. Temporary aid — will be removed
 * or redesigned in a later phase.
 */
export function LeadDebugPanel({ lead }: LeadDebugPanelProps) {
  const [open, setOpen] = useState(false);

  const config = useMemo(() => getEffectiveConfig(), []);
  const weights = useMemo(() => scoreWeights(config.scoring), [config]);
  const total = useMemo(() => maxScore(config.scoring), [config]);
  const { score, temperature, breakdown } = useMemo(
    () => calculateLeadScore(lead, config.scoring),
    [lead, config],
  );

  if (process.env.NODE_ENV === "production") return null;

  const filledCount = LEAD_FIELD_KEYS.filter(
    (key) => lead[key] !== null && lead[key] !== undefined,
  ).length;
  const temp = TEMPERATURE_STYLES[temperature];
  const scorePercent = total > 0 ? (score / total) * 100 : 0;

  return (
    <div className="fixed bottom-3 right-3 z-50 w-[min(20rem,calc(100vw-1.5rem))] font-mono">
      {open ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[11px] font-semibold tracking-wide text-foreground">
              LEAD · DEBUG · {config.templateSlug}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted transition-colors hover:text-foreground"
              aria-label="Collapse lead panel"
            >
              ✕
            </button>
          </div>

          {/* Score */}
          <div className="border-b border-border px-3 py-3">
            <div className="flex items-baseline justify-between">
              <span className={`text-3xl font-semibold ${temp.text}`}>
                {score}
                <span className="ml-1 text-xs font-normal text-muted">
                  / {total}
                </span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest ${temp.badge}`}
              >
                {temperature}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className={`h-full rounded-full transition-all duration-300 ${temp.bar}`}
                style={{ width: `${scorePercent}%` }}
              />
            </div>
          </div>

          {/* Score breakdown */}
          <dl className="divide-y divide-border/60 text-[11px]">
            {Object.entries(breakdown).map(([key, earned]) => {
              const max = weights[key] ?? 0;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 px-3 py-1.5"
                >
                  <dt className="text-muted">{key}</dt>
                  <dd className="flex items-center gap-2">
                    <span className="h-1 w-16 overflow-hidden rounded-full bg-border">
                      <span
                        className={`block h-full rounded-full ${
                          earned > 0 ? "bg-accent" : ""
                        }`}
                        style={{
                          width: `${max > 0 ? (earned / max) * 100 : 0}%`,
                        }}
                      />
                    </span>
                    <span
                      className={`tabular-nums ${
                        earned > 0 ? "text-foreground" : "text-muted/50"
                      }`}
                    >
                      {earned}
                      <span className="text-muted/50"> / {max}</span>
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>

          {/* Extracted values */}
          <dl className="divide-y divide-border/60 border-t border-border text-[11px]">
            {LEAD_FIELD_KEYS.map((key) => {
              const value = lead[key];
              const isEmpty = value === null || value === undefined;
              return (
                <div
                  key={key}
                  className="flex items-start justify-between gap-3 px-3 py-1.5"
                >
                  <dt className="text-muted">{key}</dt>
                  <dd
                    className={
                      isEmpty
                        ? "text-muted/50"
                        : "text-right text-accent-foreground"
                    }
                  >
                    {isEmpty ? "null" : JSON.stringify(value)}
                  </dd>
                </div>
              );
            })}
          </dl>

          <pre className="max-h-40 overflow-auto border-t border-border bg-background px-3 py-2 text-[10px] leading-relaxed text-muted">
            {JSON.stringify({ score, temperature, breakdown, lead }, null, 2)}
          </pre>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-medium shadow-lg shadow-black/40 transition-colors hover:border-border/80"
        >
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${temp.bar}`} />
          <span className={`font-semibold ${temp.text}`}>{score}</span>
          <span className="text-muted">{temperature}</span>
          <span className="text-muted/50">·</span>
          <span className="text-muted">
            {filledCount}/{LEAD_FIELD_KEYS.length}
          </span>
        </button>
      )}
    </div>
  );
}
