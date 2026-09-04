import { SkeletonRows } from "@/components/dashboard/states";

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <div className="h-8 w-48 rounded-lg border border-border bg-surface/60" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-xl border border-border bg-surface/60"
          />
        ))}
      </div>
      <SkeletonRows rows={5} />
    </div>
  );
}
