"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type AuthFormState } from "@/lib/auth/actions";
import { FormField } from "@/components/auth/form-field";
import { FormFeedback, SubmitButton } from "@/components/auth/form-feedback";
import { useI18n } from "@/i18n/client";
import type { ValidationError } from "@/lib/auth/validation";

const INITIAL: AuthFormState = {};

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL);

  const fieldError = (err?: ValidationError) =>
    err ? t(`validation.${err.code}`, err.params) : undefined;

  if (state.ok) {
    return (
      <FormFeedback message={state.messageCode ? t(state.messageCode) : undefined} />
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormFeedback error={state.errorCode ? t(state.errorCode) : undefined} />
      <FormField
        label={t("auth.emailLabel")}
        name="email"
        type="email"
        autoComplete="email"
        placeholder={t("auth.emailPlaceholder")}
        required
        error={fieldError(state.fieldErrors?.email)}
      />
      <SubmitButton pending={pending} pendingLabel={t("auth.forgotPassword.submitting")}>
        {t("auth.forgotPassword.submit")}
      </SubmitButton>
    </form>
  );
}
