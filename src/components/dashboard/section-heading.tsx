import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "@/components/icons";

/**
 * A dashboard section header: a line icon + the section title, with optional
 * trailing content (e.g. a "View all" link). Pure markup — safe in Server
 * Components. Keeps every `<section>` heading on the page visually identical.
 */
export function SectionHeading({
  icon: Icon,
  children,
  action,
}: {
  icon: ComponentType<IconProps>;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 shrink-0 text-muted" />
        <span>{children}</span>
      </h2>
      {action}
    </div>
  );
}
