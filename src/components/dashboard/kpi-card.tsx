import Link from "next/link";
import type { ComponentType } from "react";
import {
  TrendDownIcon,
  TrendUpIcon,
  type IconProps,
} from "@/components/icons";

/**
 * One KPI card: a pastel icon chip beside the metric title, a large value, and
 * either a compact trend line (this period vs the previous) or a plain
 * sub-line. Values are real data passed in by the page — this only renders.
 */

export type KpiTone = "indigo" | "emerald" | "amber" | "sky";

const CHIP: Record<KpiTone, string> = {
  indigo: "bg-indigo-500/10 text-indigo-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  amber: "bg-amber-500/10 text-amber-600",
  sky: "bg-sky-500/10 text-sky-600",
};

export interface KpiTrend {
  /**
   * Signed change vs the previous period (this week's new items minus last
   * week's). An absolute count — clearer than a percentage at low volume.
   */
  delta: number;
  /** Localized suffix, e.g. "vs last week". */
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
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${CHIP[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="truncate text-xs font-medium text-muted">{title}</p>
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums text-foreground">
        {value}
      </p>
      <div className="mt-1.5 text-[11px]">
        {trend ? <Trend trend={trend} /> : sublabel ? (
          <span className="text-muted/80">{sublabel}</span>
        ) : null}
      </div>
    </>
  );

  const cls =
    "block rounded-xl border border-border bg-surface p-3.5 transition-colors";
  return href ? (
    <Link href={href} className={`${cls} hover:border-accent/40`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Trend({ trend }: { trend: KpiTrend }) {
  if (trend.delta === 0) {
    return <span className="text-muted/80">{trend.label}</span>;
  }
  const up = trend.delta > 0;
  const Arrow = up ? TrendUpIcon : TrendDownIcon;
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        up ? "text-emerald-600" : "text-amber-600"
      }`}
    >
      <Arrow className="h-3 w-3" />
      <span className="font-medium tabular-nums">
        {up ? "+" : "−"}
        {Math.abs(trend.delta)}
      </span>
      <span className="text-muted/80">{trend.label}</span>
    </span>
  );
}
