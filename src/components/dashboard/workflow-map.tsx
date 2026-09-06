import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowIcon, type IconProps } from "@/components/icons";

/**
 * "Your Automation Flow" — the dashboard centerpiece. Six connected nodes
 * tracing a lead from first contact to a closed deal:
 *
 *   Lead Source → AI Qualification → Opportunity Level → Next Best Action
 *     → Follow-up & Appointment → Handoff & Recovery
 *
 * Every node card carries a live count from data the page already loads (no
 * extra queries) and deep-links to the closest real page or filtered view.
 * Desktop: a horizontal row joined by thin arrows. Arabic RTL flips the arrow
 * direction. Tablet / mobile: a vertical stack with down arrows.
 */

export type WorkflowTone = "neutral" | "active" | "attention";

const DOT: Record<WorkflowTone, string> = {
  neutral: "bg-border",
  active: "bg-emerald-500",
  attention: "bg-amber-500",
};

export type WorkflowBadgeTone = "info" | "ok" | "warn";

const BADGE: Record<WorkflowBadgeTone, string> = {
  info: "bg-sky-500/10 text-sky-700",
  ok: "bg-emerald-500/10 text-emerald-700",
  warn: "bg-amber-500/10 text-amber-700",
};

export interface WorkflowBreakdown {
  label: string;
  value: number;
}

export interface WorkflowNode {
  key: string;
  icon: ComponentType<IconProps>;
  label: string;
  value: number | string;
  caption: string;
  href: string;
  tone: WorkflowTone;
  badge?: { text: string; tone: WorkflowBadgeTone };
  /** Small labelled sub-counts, e.g. the opportunity-level split. */
  breakdown?: WorkflowBreakdown[];
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
      className="flex flex-col gap-2.5 xl:flex-row xl:items-start xl:gap-0"
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
              className="group flex flex-1 flex-col gap-2 rounded-2xl border border-border bg-surface p-3 transition-colors hover:border-accent/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600">
                  <NodeIcon className="h-4 w-4" />
                </span>
                {node.badge ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${BADGE[node.badge.tone]}`}
                  >
                    {node.badge.text}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${DOT[node.tone]}`}
                  />
                )}
              </div>

              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-muted">
                  {node.label}
                </p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                  {node.value}
                </p>
                <p className="truncate text-[11px] text-muted/90">
                  {node.caption}
                </p>
              </div>

              {node.breakdown ? (
                <dl className="space-y-0.5 text-[11px]">
                  {node.breakdown.map((b) => (
                    <div
                      key={b.label}
                      className="flex items-center justify-between gap-2"
                    >
                      <dt className="truncate text-muted">{b.label}</dt>
                      <dd className="shrink-0 tabular-nums font-medium text-foreground">
                        {b.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </Link>

            <span
              aria-hidden
              className={`flex shrink-0 items-center justify-center py-1 text-border xl:px-1.5 ${
                isLast ? "hidden xl:invisible" : ""
              }`}
            >
              <ArrowIcon className="h-4 w-4 rotate-90 xl:rotate-0 xl:rtl:-scale-x-100" />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
