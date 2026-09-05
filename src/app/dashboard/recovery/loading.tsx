import { SkeletonRows } from "@/components/dashboard/states";

export default function RecoveryLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="h-8 w-52 rounded-lg border border-border bg-surface/60" />
        <div className="h-4 w-72 rounded bg-surface/60" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-28 rounded bg-surface/60" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[86px] rounded-xl border border-border bg-surface/60" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-4 w-36 rounded bg-surface/60" />
        <SkeletonRows rows={5} />
      </div>
    </div>
  );
}
