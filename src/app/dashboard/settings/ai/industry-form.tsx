"use client";

import { useActionState, useState } from "react";
import {
  changeIndustryAction,
  type ChangeIndustryFormState,
} from "@/lib/org/industry-actions";
import { FormFeedback, SubmitButton } from "@/components/auth/form-feedback";
import { useI18n } from "@/i18n/client";

export interface IndustryChoice {
  slug: string;
  name: string;
  description: string;
}

const INITIAL: ChangeIndustryFormState = {};

export function IndustryForm({
  current,
  choices,
  canManage,
}: {
  current: string;
  choices: IndustryChoice[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(changeIndustryAction, INITIAL);
  const [selected, setSelected] = useState(current);

  const dirty = selected !== current;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="text-base font-semibold text-foreground">
        {t("settingsIndustry.title")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("settingsIndustry.subtitle")}</p>

      <form action={formAction} className="mt-4 space-y-4">
        {state.errorCode ? <FormFeedback error={t(state.errorCode)} /> : null}
        {state.ok && state.changed ? (
          <FormFeedback message={t("settingsIndustry.saved")} />
        ) : null}

        <fieldset className="space-y-2" disabled={!canManage}>
          {choices.map((choice) => {
            const isSelected = selected === choice.slug;
            return (
              <label
                key={choice.slug}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  isSelected
                    ? "border-accent/70 bg-accent/10"
                    : "border-border hover:border-border/80"
                } ${!canManage ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <input
                  type="radio"
                  name="industry"
                  value={choice.slug}
                  checked={isSelected}
                  onChange={() => setSelected(choice.slug)}
                  disabled={!canManage}
                  className="mt-0.5 h-3.5 w-3.5 accent-accent"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {choice.name}
                    {choice.slug === current ? (
                      <span className="ms-2 text-xs font-normal text-muted">
                        {t("settingsIndustry.currentTag")}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted">{choice.description}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {dirty ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {t("settingsIndustry.resetWarning")}
          </p>
        ) : null}

        {canManage ? (
          <div className="max-w-xs">
            <SubmitButton
              pending={pending}
              disabled={!dirty}
              pendingLabel={t("settingsIndustry.saving")}
            >
              {t("settingsIndustry.save")}
            </SubmitButton>
          </div>
        ) : (
          <p className="inline-block rounded-md border border-border bg-background px-2 py-1 text-xs text-muted">
            {t("settingsIndustry.readonly")}
          </p>
        )}
      </form>
    </section>
  );
}
