"use client";

import { useI18n } from "@/i18n/client";
import { humanizeKey } from "@/lib/leads/lead-view";

const TEMPERATURE_STYLE: Record<string, string> = {
  hot: "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30",
  warm: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30",
  cold: "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30",
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
  contacted: "bg-sky-500/10 text-sky-300",
  qualified: "bg-accent/15 text-foreground",
  appointment: "bg-violet-500/15 text-violet-300",
  won: "bg-emerald-500/15 text-emerald-300",
  lost: "bg-rose-500/10 text-rose-300",
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
