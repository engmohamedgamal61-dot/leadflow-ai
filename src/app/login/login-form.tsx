"use client";

import { useActionState } from "react";
import { signInAction, type AuthFormState } from "@/lib/auth/actions";
import { FormField } from "@/components/auth/form-field";
import { FormFeedback, SubmitButton } from "@/components/auth/form-feedback";
import { useI18n } from "@/i18n/client";
import type { ValidationError } from "@/lib/auth/validation";

const INITIAL: AuthFormState = {};

export function LoginForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);

  const fieldError = (err?: ValidationError) =>
    err ? t(`validation.${err.code}`, err.params) : undefined;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormFeedback
        error={state.errorCode ? t(state.errorCode) : undefined}
        message={state.messageCode ? t(state.messageCode) : undefined}
      />

      <FormField
        label={t("auth.emailLabel")}
        name="email"
        type="email"
        autoComplete="email"
        placeholder={t("auth.emailPlaceholder")}
        required
        error={fieldError(state.fieldErrors?.email)}
      />
      <FormField
        label={t("auth.passwordLabel")}
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder={t("auth.passwordPlaceholder")}
        required
        error={fieldError(state.fieldErrors?.password)}
      />

      <SubmitButton pending={pending} pendingLabel={t("auth.login.submitting")}>
        {t("auth.login.submit")}
      </SubmitButton>
    </form>
  );
}
