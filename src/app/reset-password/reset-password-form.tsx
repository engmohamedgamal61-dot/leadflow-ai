"use client";

import { useActionState } from "react";
import { updatePasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH, type ValidationError } from "@/lib/auth/validation";
import { FormField } from "@/components/auth/form-field";
import { FormFeedback, SubmitButton } from "@/components/auth/form-feedback";
import { useI18n } from "@/i18n/client";

const INITIAL: AuthFormState = {};

export function ResetPasswordForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(updatePasswordAction, INITIAL);

  const fieldError = (err?: ValidationError) =>
    err ? t(`validation.${err.code}`, err.params) : undefined;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormFeedback error={state.errorCode ? t(state.errorCode) : undefined} />
      <FormField
        label={t("auth.resetPassword.newPasswordLabel")}
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder={t("auth.passwordPlaceholder")}
        required
        minLength={PASSWORD_MIN_LENGTH}
        error={fieldError(state.fieldErrors?.password)}
        hint={t("auth.signup.passwordHint", { min: PASSWORD_MIN_LENGTH })}
      />
      <SubmitButton pending={pending} pendingLabel={t("auth.resetPassword.submitting")}>
        {t("auth.resetPassword.submit")}
      </SubmitButton>
    </form>
  );
}
