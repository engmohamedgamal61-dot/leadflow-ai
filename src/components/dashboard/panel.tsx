import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "@/components/icons";

/**
 * A dashboard content card with a titled header: an accent icon, a heading, an
 * optional one-line subtitle, and an optional action on the opposite side.
 * Pure markup — safe in Server Components. Matches the reference: white card,
 * 16px radius, hairline border, ~20px header padding.
 */

export function Panel({
  icon: Icon,
  title,
  subtitle,
  action,
  emphasis = false,
  headerClassName,
  bodyClassName,
  children,
  id,
}: {
  icon: ComponentType<IconProps>;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  emphasis?: boolean;
  headerClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-surface ${
        emphasis
          ? "shadow-[0_1px_3px_0_rgba(16,24,40,0.06)]"
          : "shadow-[0_1px_2px_0_rgba(16,24,40,0.04)]"
      }`}
    >
      <header
        className={
          headerClassName ??
          "flex items-start justify-between gap-3 px-5 py-3.5"
        }
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className="h-[17px] w-[17px] shrink-0 text-accent" />
          <div className="min-w-0">
            <h2 className="text-[15.5px] font-semibold leading-tight text-foreground">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-[12px] leading-snug text-muted">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={bodyClassName ?? "px-5 pb-5"}>{children}</div>
    </section>
  );
}

/** A bordered "View all →" style action for panel headers. */
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
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground"
    >
      {children}
      <span aria-hidden className="rtl:-scale-x-100">
        →
      </span>
    </Link>
  );
}
