import type { ReactNode } from "react";

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/50 px-6 py-14 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-xs text-muted">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-6 py-10 text-center">
      <p className="text-sm font-medium text-rose-300">
        Something went wrong loading this data.
      </p>
      {message ? <p className="mt-1 text-xs text-muted">{message}</p> : null}
    </div>
  );
}

/** Static placeholder block for Suspense fallbacks (no animation). */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-14 rounded-lg border border-border bg-surface/60"
        />
      ))}
      <p className="pt-1 text-center text-xs text-muted">Loading…</p>
    </div>
  );
}
