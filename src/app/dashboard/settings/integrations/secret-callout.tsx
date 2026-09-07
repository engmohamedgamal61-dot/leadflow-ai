"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";

/** One-time display of a freshly created / rotated signing secret. */
export function SecretCallout({ secret }: { secret: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
        {t("integrationHub.secret.newSecretTitle")}
      </p>
      <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90">
        {t("integrationHub.secret.newSecretBody")}
      </p>
      <div className="flex items-start gap-2">
        <code
          dir="ltr"
          className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] text-foreground"
        >
          {secret}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(secret).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
        >
          {copied ? t("integrationHub.secret.copied") : t("integrationHub.secret.copy")}
        </button>
      </div>
    </div>
  );
}
