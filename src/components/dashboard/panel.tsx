import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "@/components/icons";

/**
 * A dashboard content card with a titled header: a pastel icon chip, a
 * heading, a one-line subtitle, and an optional action on the opposite side.
 * Pure markup — safe in Server Components. Body is whatever the caller passes
 * (a list, a table, an empty state).
 */

export type PanelTone = "indigo" | "emerald" | "amber" | "sky";

const CHIP: Record<PanelTone, string> = {
  indigo: "bg-indigo-500/10 text-indigo-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  amber: "bg-amber-500/10 text-amber-600",
  sky: "bg-sky-500/10 text-sky-600",
};

export function Panel({
  icon: Icon,
  title,
  subtitle,
  action,
  tone = "indigo",
  bodyClassName,
  children,
  id,
}: {
  icon: ComponentType<IconProps>;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  tone?: PanelTone;
  /** Extra classes for the body wrapper (default has padding). */
  bodyClassName?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-border bg-surface"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${CHIP[tone]}`}
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0 text-xs">{action}</div> : null}
      </header>
      <div className={bodyClassName ?? "p-2"}>{children}</div>
    </section>
  );
}
