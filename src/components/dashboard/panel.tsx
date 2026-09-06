import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "@/components/icons";

/**
 * A dashboard content card with a titled header: a pastel icon chip, a
 * heading, an optional one-line subtitle, and an optional action on the
 * opposite side. Pure markup — safe in Server Components. `emphasis` gives the
 * Automation Flow centerpiece a slightly stronger frame.
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
  emphasis = false,
  bodyClassName,
  children,
  id,
}: {
  icon: ComponentType<IconProps>;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  tone?: PanelTone;
  emphasis?: boolean;
  bodyClassName?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-20 overflow-hidden rounded-2xl border bg-surface ${
        emphasis
          ? "border-border shadow-sm shadow-black/[0.04]"
          : "border-border"
      }`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${CHIP[tone]}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {title}
            </h2>
            {subtitle ? (
              <p className="text-[11px] leading-snug text-muted">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={bodyClassName ?? "p-2"}>{children}</div>
    </section>
  );
}

/** A small bordered "View all →" style action for panel headers. */
export function PanelAction({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground"
    >
      {children}
      <span aria-hidden className="rtl:-scale-x-100">
        →
      </span>
    </Link>
  );
}
