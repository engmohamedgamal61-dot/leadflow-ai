interface StatCardProps {
  label: string;
  value: number | string;
  accent?: "default" | "hot" | "warm" | "cold";
}

const ACCENT: Record<string, string> = {
  default: "text-foreground",
  hot: "text-rose-700",
  warm: "text-amber-700",
  cold: "text-sky-700",
};

export function StatCard({ label, value, accent = "default" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${ACCENT[accent]}`}>
        {value}
      </p>
    </div>
  );
}
