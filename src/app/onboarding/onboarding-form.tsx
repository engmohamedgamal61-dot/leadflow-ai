"use client";

import { useActionState, useState } from "react";
import {
  onboardAction,
  type OnboardingFormState,
} from "@/lib/auth/actions";
import type { ValidationError } from "@/lib/auth/validation";
import { FormField } from "@/components/auth/form-field";
import { FormFeedback, SubmitButton } from "@/components/auth/form-feedback";
import { useI18n } from "@/i18n/client";

export interface IndustryOption {
  slug: string;
  name: string;
  description: string;
}

const INITIAL: OnboardingFormState = {};

export function OnboardingForm({ industries }: { industries: IndustryOption[] }) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(onboardAction, INITIAL);
  const [industry, setIndustry] = useState(industries[0]?.slug ?? "");

  const fieldError = (err?: ValidationError) =>
    err ? t(`validation.${err.code}`, err.params) : undefined;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormFeedback error={state.errorCode ? t(state.errorCode) : undefined} />

      <FormField
        label={t("onboarding.orgNameLabel")}
        name="name"
        type="text"
        autoComplete="organization"
        placeholder={t("onboarding.orgNamePlaceholder")}
        required
        error={fieldError(state.fieldErrors?.name)}
      />

      <fieldset className="space-y-1.5">
        <legend className="block text-xs font-medium text-muted">
          {t("onboarding.industryLabel")}
        </legend>
        <div className="space-y-2">
          {industries.map((option) => {
            const selected = industry === option.slug;
            return (
              <label
                key={option.slug}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  selected
                    ? "border-accent/70 bg-accent/10"
                    : "border-border hover:border-border/80"
                }`}
              >
                <input
                  type="radio"
                  name="industry"
                  value={option.slug}
                  checked={selected}
                  onChange={() => setIndustry(option.slug)}
                  className="mt-0.5 h-3.5 w-3.5 accent-accent"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {option.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {state.fieldErrors?.industry ? (
          <p className="text-xs text-red-400">
            {fieldError(state.fieldErrors.industry)}
          </p>
        ) : null}
      </fieldset>

      <SubmitButton pending={pending} pendingLabel={t("onboarding.submitting")}>
        {t("onboarding.submit")}
      </SubmitButton>
    </form>
  );
}
