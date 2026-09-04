"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-6 py-12 text-center">
      <p className="text-sm font-medium text-rose-300">
        We couldn&apos;t load this page.
      </p>
      <p className="mt-1 text-xs text-muted">
        {error.digest ? `Reference: ${error.digest}` : "Please try again."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
      >
        Retry
      </button>
    </div>
  );
}
