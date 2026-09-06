import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowIcon, type IconProps } from "@/components/icons";

/**
 * A compact node-based view of the lead automation pipeline, in the spirit of
 * workflow / automation tools:
 *
 *   Lead source → AI qualification → Opportunity level → Next best action
 *     → Follow-up & appointment → Handoff & recovery
 *
 * Each node is a small card (icon, soft status dot, a live count pulled from
 * data the dashboard already loads — no extra queries) and deep-links to the
 * matching page or filtered view. Horizontal with arrow connectors on `lg`,
 * a vertical stack with down connectors below. Pure markup + `<Link>`, so it
 * renders on the server and inherits the page's role-scoped data.
 */

export type WorkflowTone = "neutral" | "active" | "attention";

export interface WorkflowNode {
  key: string;
  icon: ComponentType<IconProps>;
  label: string;
  sub: string;
  value: number | string;
  href: string;
  tone: WorkflowTone;
}

const TONE_DOT: Record<WorkflowTone, string> = {
  neutral: "bg-border",
  active: "bg-emerald-500",
  attention: "bg-amber-500",
};

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
      className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0"
    >
      {nodes.map((node, i) => {
        const NodeIcon = node.icon;
        const isLast = i === nodes.length - 1;
        return (
          <li
            key={node.key}
            className="flex flex-col lg:flex-1 lg:flex-row lg:items-stretch"
          >
            <Link
              href={node.href}
              className="group flex flex-1 items-start gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-accent/50 hover:bg-background/40 lg:flex-col lg:gap-2.5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted transition-colors group-hover:text-foreground">
                <NodeIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[node.tone]}`}
                  />
                  <span className="truncate">{node.label}</span>
                </span>
                <span className="mt-1 block text-lg font-semibold tabular-nums text-foreground">
                  {node.value}
                </span>
                <span className="block text-[11px] text-muted">{node.sub}</span>
              </span>
            </Link>
            <span
              aria-hidden
              className={`flex shrink-0 items-center justify-center py-1 text-muted/40 lg:px-1 ${
                isLast ? "hidden lg:invisible" : ""
              }`}
            >
              <ArrowIcon className="h-4 w-4 rotate-90 lg:rotate-0 lg:rtl:-scale-x-100" />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
