"use client";

import { useI18n } from "@/i18n/client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-6 py-12 text-center">
      <p className="text-sm font-medium text-rose-700">
        {t("errors.dashboard.title")}
      </p>
      <p className="mt-1 text-xs text-muted">
        {error.digest
          ? t("errors.dashboard.reference", { digest: error.digest })
          : t("errors.dashboard.tryAgain")}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
      >
        {t("errors.dashboard.retry")}
      </button>
    </div>
  );
}
