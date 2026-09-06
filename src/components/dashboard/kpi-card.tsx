import Link from "next/link";
import type { ComponentType } from "react";
import {
  TrendDownIcon,
  TrendUpIcon,
  type IconProps,
} from "@/components/icons";

/**
 * One KPI card: a pastel icon chip, a large value, a small title, and an
 * optional compact trend chip (this period vs the previous period). Every
 * value is real data passed in by the page — this component only renders.
 */

export type KpiTone = "indigo" | "emerald" | "amber" | "sky";

const CHIP: Record<KpiTone, string> = {
  indigo: "bg-indigo-500/10 text-indigo-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  amber: "bg-amber-500/10 text-amber-600",
  sky: "bg-sky-500/10 text-sky-600",
};

export interface KpiTrend {
  /** Signed change vs the previous period (e.g. current - previous). */
  delta: number;
  /** Localized descriptor, e.g. "vs last 7 days". */
  label: string;
}

export function KpiCard({
  icon: Icon,
  title,
  value,
  sublabel,
  trend,
  tone = "indigo",
  href,
}: {
  icon: ComponentType<IconProps>;
  title: string;
  value: number | string;
  sublabel?: string;
  trend?: KpiTrend;
  tone?: KpiTone;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${CHIP[tone]}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {trend ? <TrendChip trend={trend} /> : null}
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted">{title}</p>
      {sublabel ? (
        <p className="mt-0.5 text-[11px] text-muted/80">{sublabel}</p>
      ) : null}
    </>
  );

  const cls =
    "block rounded-2xl border border-border bg-surface p-4 transition-colors";
  if (href) {
    return (
      <Link href={href} className={`${cls} hover:border-accent/40`}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

function TrendChip({ trend }: { trend: KpiTrend }) {
  if (trend.delta === 0) {
    return (
      <span
        className="rounded-full bg-border/50 px-1.5 py-0.5 text-[11px] font-medium text-muted"
        title={trend.label}
      >
        {"—"}
      </span>
    );
  }
  const up = trend.delta > 0;
  const Arrow = up ? TrendUpIcon : TrendDownIcon;
  return (
    <span
      className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
        up ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"
      }`}
      title={trend.label}
    >
      <Arrow className="h-3 w-3" />
      <span className="tabular-nums">
        {up ? "+" : "−"}
        {Math.abs(trend.delta)}
      </span>
    </span>
  );
}
