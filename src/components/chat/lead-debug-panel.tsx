"use client";

import { useState } from "react";
import { LEAD_FIELD_KEYS, type LeadData } from "@/types/chat";

interface LeadDebugPanelProps {
  lead: LeadData;
}

/**
 * Development-only inspector for the structured lead data extracted alongside
 * each assistant reply. Hidden entirely in production builds. This panel is a
 * temporary aid and will be removed or redesigned in a later phase.
 */
export function LeadDebugPanel({ lead }: LeadDebugPanelProps) {
  const [open, setOpen] = useState(false);

  if (process.env.NODE_ENV === "production") return null;

  const filledCount = LEAD_FIELD_KEYS.filter(
    (key) => lead[key] !== null && lead[key] !== undefined,
  ).length;

  return (
    <div className="fixed bottom-3 right-3 z-50 w-[min(20rem,calc(100vw-1.5rem))] font-mono">
      {open ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[11px] font-semibold tracking-wide text-foreground">
              LEAD DATA · DEBUG
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted transition-colors hover:text-foreground"
              aria-label="Collapse lead data panel"
            >
              ✕
            </button>
          </div>

          <dl className="divide-y divide-border/60 text-[11px]">
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

          <pre className="max-h-48 overflow-auto border-t border-border bg-background px-3 py-2 text-[10px] leading-relaxed text-muted">
            {JSON.stringify({ lead }, null, 2)}
          </pre>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-medium text-muted shadow-lg shadow-black/40 transition-colors hover:text-foreground"
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              filledCount > 0 ? "bg-accent" : "bg-border"
            }`}
          />
          Lead data · {filledCount}/{LEAD_FIELD_KEYS.length}
        </button>
      )}
    </div>
  );
}
