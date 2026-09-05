"use client";

import type { ReactNode } from "react";
import type { SettingsFormState } from "@/lib/config/settings-actions";
import { useI18n } from "@/i18n/client";

export function SectionShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Feedback({ state }: { state: SettingsFormState }) {
  const { t } = useI18n();
  if (state.ok) {
    return (
      <p role="status" className="text-xs text-emerald-600">
        {t("settings.saved")}
      </p>
    );
  }
  if (state.errorCode) {
    return (
      <div role="alert" className="space-y-1 text-xs text-rose-600">
        <p>{t(state.errorCode, state.errorParams)}</p>
        {state.details?.length ? (
          <ul className="list-inside list-disc text-rose-600/80">
            {state.details.slice(0, 6).map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return null;
}

export function SaveButton({ pending }: { pending: boolean }) {
  const { t } = useI18n();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? t("common.saving") : t("common.saveChanges")}
    </button>
  );
}
