"use client";

import { useActionState, useState } from "react";
import {
  onboardAction,
  type OnboardingFormState,
} from "@/lib/auth/actions";
import { FormField } from "@/components/auth/form-field";
import { FormFeedback, SubmitButton } from "@/components/auth/form-feedback";

export interface IndustryOption {
  slug: string;
  name: string;
  description: string;
}

const INITIAL: OnboardingFormState = {};

export function OnboardingForm({ industries }: { industries: IndustryOption[] }) {
  const [state, formAction, pending] = useActionState(onboardAction, INITIAL);
  const [industry, setIndustry] = useState(industries[0]?.slug ?? "");

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormFeedback error={state.error} />

      <FormField
        label="Organization name"
        name="name"
        type="text"
        autoComplete="organization"
        placeholder="Acme Realty"
        required
        error={state.fieldErrors?.name}
      />

      <fieldset className="space-y-1.5">
        <legend className="block text-xs font-medium text-muted">
          Industry template
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
          <p className="text-xs text-red-400">{state.fieldErrors.industry}</p>
        ) : null}
      </fieldset>

      <SubmitButton pending={pending} pendingLabel="Creating organization…">
        Create organization
      </SubmitButton>
    </form>
  );
}
