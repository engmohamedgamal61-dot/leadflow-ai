import Link from "next/link";

interface StatCardProps {
  label: string;
  value: number | string;
  accent?: "default" | "hot" | "warm" | "cold";
  /** Optional secondary line under the value (already localized). */
  sublabel?: string;
  /** When set, the whole card becomes a link with a hover affordance. */
  href?: string;
}

const ACCENT: Record<string, string> = {
  default: "text-foreground",
  hot: "text-rose-700",
  warm: "text-amber-700",
  cold: "text-sky-700",
};

export function StatCard({ label, value, accent = "default", sublabel, href }: StatCardProps) {
  const body = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${ACCENT[accent]}`}>{value}</p>
      {sublabel ? <p className="mt-0.5 text-[11px] text-muted/80">{sublabel}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/50 hover:bg-background/40"
      >
        {body}
      </Link>
    );
  }

  return <div className="rounded-xl border border-border bg-surface p-4">{body}</div>;
}
