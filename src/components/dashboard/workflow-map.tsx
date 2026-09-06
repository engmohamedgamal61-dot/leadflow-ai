import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { ArrowIcon, type IconProps } from "@/components/icons";

/**
 * "Your Automation Flow" — the dashboard centerpiece. Six numbered, connected
 * nodes tracing a lead from first contact to a closed deal. Every node carries
 * a live count from data the page already loads (no extra queries) and
 * deep-links to the closest real page or filtered view. Desktop: a horizontal
 * row joined by pale connector rails. Arabic RTL flips the flow direction.
 * Tablet / mobile: a vertical stack with down connectors.
 */

export type WorkflowTone = "neutral" | "active" | "attention";

const DOT: Record<WorkflowTone, string> = {
  neutral: "bg-border",
  active: "bg-emerald-500",
  attention: "bg-amber-500",
};

export type WorkflowIconTone = "blue" | "teal" | "violet" | "indigo" | "rose";

const CHIP: Record<WorkflowIconTone, string> = {
  blue: "bg-blue-500/10 text-blue-600",
  teal: "bg-teal-500/10 text-teal-600",
  violet: "bg-violet-500/10 text-violet-600",
  indigo: "bg-indigo-500/10 text-indigo-600",
  rose: "bg-rose-500/10 text-rose-600",
};

export type WorkflowBadgeTone = "info" | "ok" | "warn" | "danger";

const BADGE: Record<WorkflowBadgeTone, string> = {
  info: "bg-blue-500/10 text-blue-700",
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
  /** Optional custom footer content (e.g. channel chips) — replaces the badge. */
  footer?: ReactNode;
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
      className="flex flex-col gap-2 xl:flex-row xl:items-stretch xl:gap-0"
    >
      {nodes.map((node, i) => {
        const NodeIcon = node.icon;
        const isLast = i === nodes.length - 1;
        return (
          <li
            key={node.key}
            className="flex flex-col xl:min-w-0 xl:flex-1 xl:flex-row xl:items-stretch"
          >
            <Link
              href={node.href}
              className="group flex flex-1 flex-col items-center gap-1 rounded-xl border border-border bg-surface p-2 text-center transition-colors hover:border-accent/50 hover:shadow-sm hover:shadow-black/[0.03]"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${CHIP[node.iconTone]}`}
              >
                <NodeIcon className="h-4 w-4" />
              </span>
              <span className="flex min-h-[2em] items-center justify-center gap-1 text-[12px] font-medium leading-[1.15] text-foreground">
                <span className="text-muted/70">{i + 1}.</span>
                <span>{node.label}</span>
              </span>
              <span className="text-[19px] font-bold leading-none tabular-nums text-foreground">
                {node.value}
              </span>
              <span className="text-[10.5px] leading-tight text-muted">
                {node.caption}
              </span>
              <span className="mt-auto flex min-h-[20px] items-center pt-0.5">
                {node.footer ? (
                  node.footer
                ) : node.badge ? (
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-medium ${BADGE[node.badge.tone]}`}
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
              className={`flex shrink-0 items-center justify-center py-0.5 xl:w-6 xl:py-0 ${
                isLast ? "hidden xl:hidden" : ""
              }`}
            >
              <span className="flex items-center justify-center rounded-md bg-foreground/[0.04] text-muted/45 max-xl:h-4 max-xl:w-6 xl:h-[60px] xl:w-4">
                <ArrowIcon className="h-3 w-3 rotate-90 xl:rotate-0 xl:rtl:-scale-x-100" />
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
