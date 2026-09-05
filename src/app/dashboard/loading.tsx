import { SkeletonRows } from "@/components/dashboard/states";

function CardRow({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-[86px] rounded-xl border border-border bg-surface/60" />
      ))}
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="h-3 w-16 rounded bg-surface/60" />
        <div className="h-8 w-56 rounded-lg border border-border bg-surface/60" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-32 rounded bg-surface/60" />
        <CardRow count={8} />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-32 rounded bg-surface/60" />
        <div className="h-40 rounded-xl border border-border bg-surface/60" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-24 rounded bg-surface/60" />
        <SkeletonRows rows={5} />
      </div>
    </div>
  );
}
