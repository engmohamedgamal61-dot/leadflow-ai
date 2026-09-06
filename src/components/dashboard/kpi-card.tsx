import Link from "next/link";
import type { ComponentType } from "react";
import {
  TrendDownIcon,
  TrendUpIcon,
  type IconProps,
} from "@/components/icons";

/**
 * One KPI card, matching the reference: a large pastel icon chip on the left,
 * the metric title and value stacked beside it, and a trend line below.
 * Values are real data passed in by the page — this only renders.
 */

export type KpiTone = "blue" | "emerald" | "violet" | "amber";

const CHIP: Record<KpiTone, string> = {
  blue: "bg-blue-500/10 text-blue-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  violet: "bg-violet-500/10 text-violet-600",
  amber: "bg-amber-500/10 text-amber-600",
};

export interface KpiTrend {
  /** Signed change vs the previous period — an absolute count. */
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
  tone = "blue",
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
      <div className="flex items-center gap-3.5">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${CHIP[tone]}`}
        >
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] leading-tight text-muted">{title}</p>
          <p className="mt-1 text-[27px] font-bold leading-none tracking-tight tabular-nums text-foreground">
            {value}
          </p>
        </div>
      </div>
      <div className="mt-3 text-xs">
        {trend ? (
          <Trend trend={trend} />
        ) : sublabel ? (
          <span className="text-muted">{sublabel}</span>
        ) : null}
      </div>
    </>
  );

  const cls = "block rounded-2xl border border-border bg-surface p-5 transition-colors";
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
    return <span className="text-muted">{trend.label}</span>;
  }
  const up = trend.delta > 0;
  const Arrow = up ? TrendUpIcon : TrendDownIcon;
  return (
    <span className="inline-flex items-center gap-1">
      <Arrow
        className={`h-3.5 w-3.5 ${up ? "text-emerald-600" : "text-amber-600"}`}
      />
      <span
        className={`font-semibold tabular-nums ${up ? "text-emerald-600" : "text-amber-600"}`}
      >
        {up ? "+" : "−"}
        {Math.abs(trend.delta)}
      </span>
      <span className="text-muted">{trend.label}</span>
    </span>
  );
}
