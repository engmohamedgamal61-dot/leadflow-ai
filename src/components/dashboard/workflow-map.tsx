import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowIcon, type IconProps } from "@/components/icons";

/**
 * "Your Automation Flow" — the dashboard centerpiece. Six numbered, connected
 * nodes tracing a lead from first contact to a closed deal:
 *
 *   1 Lead Source → 2 AI Qualification → 3 Opportunity Level
 *     → 4 Next Best Action → 5 Follow-up & Appointment → 6 Handoff & Recovery
 *
 * Every node carries a live count from data the page already loads (no extra
 * queries) and deep-links to the closest real page or filtered view. Desktop:
 * a horizontal row joined by pill connectors. Arabic RTL flips the arrow
 * direction and the number stays at the reading start. Tablet / mobile: a
 * vertical stack with down connectors.
 */

export type WorkflowTone = "neutral" | "active" | "attention";

const DOT: Record<WorkflowTone, string> = {
  neutral: "bg-border",
  active: "bg-emerald-500",
  attention: "bg-amber-500",
};

export type WorkflowIconTone = "indigo" | "sky" | "emerald" | "violet" | "rose";

const CHIP: Record<WorkflowIconTone, string> = {
  indigo: "bg-indigo-500/10 text-indigo-600",
  sky: "bg-sky-500/10 text-sky-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  violet: "bg-violet-500/10 text-violet-600",
  rose: "bg-rose-500/10 text-rose-600",
};

export type WorkflowBadgeTone = "info" | "ok" | "warn" | "danger";

const BADGE: Record<WorkflowBadgeTone, string> = {
  info: "bg-sky-500/10 text-sky-700",
  ok: "bg-emerald-500/10 text-emerald-700",
  warn: "bg-amber-500/10 text-amber-700",
  danger: "bg-rose-500/10 text-rose-700",
};

export interface WorkflowNode {
  key: string;
  icon: ComponentType<IconProps>;
  iconTone: WorkflowIconTone;
  label: string;
  value: number | string;
  caption: string;
  href: string;
  tone: WorkflowTone;
  badge?: { text: string; tone: WorkflowBadgeTone };
}

export function WorkflowMap({
  nodes,
  ariaLabel,
}: {
  nodes: WorkflowNode[];
  ariaLabel: string;
}) {
  return (
    <ol
      aria-label={ariaLabel}
      className="flex flex-col gap-1.5 xl:flex-row xl:items-stretch xl:gap-0"
    >
      {nodes.map((node, i) => {
        const NodeIcon = node.icon;
        const isLast = i === nodes.length - 1;
        return (
          <li
            key={node.key}
            className="flex flex-col xl:min-w-0 xl:flex-1 xl:flex-row xl:items-center"
          >
            <Link
              href={node.href}
              className="group flex flex-1 flex-col items-center gap-1.5 rounded-xl border border-border bg-surface p-3 text-center transition-colors hover:border-accent/50 hover:shadow-sm hover:shadow-black/[0.03]"
            >
              <span className="relative">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${CHIP[node.iconTone]}`}
                >
                  <NodeIcon className="h-5 w-5" />
                </span>
                <span
                  aria-hidden
                  className="absolute -start-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-[9px] font-semibold tabular-nums text-muted"
                >
                  {i + 1}
                </span>
              </span>
              <p className="text-xs font-medium leading-tight text-foreground">
                {node.label}
              </p>
              <p className="text-2xl font-semibold leading-none tabular-nums text-foreground">
                {node.value}
              </p>
              <p className="text-[11px] text-muted/90">{node.caption}</p>
              <span className="mt-auto pt-0.5">
                {node.badge ? (
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${BADGE[node.badge.tone]}`}
                  >
                    {node.badge.text}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[node.tone]}`}
                  />
                )}
              </span>
            </Link>

            <span
              aria-hidden
              className={`flex shrink-0 items-center justify-center py-0.5 xl:px-1 ${
                isLast ? "hidden xl:invisible" : ""
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-background text-muted/50">
                <ArrowIcon className="h-3.5 w-3.5 rotate-90 xl:rotate-0 xl:rtl:-scale-x-100" />
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
