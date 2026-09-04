import { SkeletonRows } from "@/components/dashboard/states";

export default function LeadsLoading() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-32 rounded-lg border border-border bg-surface/60" />
      <div className="h-10 rounded-lg border border-border bg-surface/60" />
      <SkeletonRows rows={8} />
    </div>
  );
}
