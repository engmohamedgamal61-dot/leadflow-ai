"use client";

import { useActionState } from "react";
import { signUpAction, type AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH, type ValidationError } from "@/lib/auth/validation";
import { FormField } from "@/components/auth/form-field";
import { FormFeedback, SubmitButton } from "@/components/auth/form-feedback";
import { useI18n } from "@/i18n/client";

const INITIAL: AuthFormState = {};

export function SignupForm({
  next,
  gated = false,
  emailDefault,
}: {
  next?: string;
  gated?: boolean;
  emailDefault?: string;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(signUpAction, INITIAL);

  const fieldError = (err?: ValidationError) =>
    err ? t(`validation.${err.code}`, err.params) : undefined;

  // An invite link carries its own token — the signup gate doesn't apply.
  const showInviteCode = gated && !next?.startsWith("/invite/");

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormFeedback
        error={state.errorCode ? t(state.errorCode) : undefined}
        message={state.messageCode ? t(state.messageCode) : undefined}
      />

      {showInviteCode ? (
        <FormField
          label={t("auth.signup.inviteCodeLabel")}
          name="inviteCode"
          type="text"
          autoComplete="off"
          required
          error={fieldError(state.fieldErrors?.inviteCode)}
          hint={t("auth.signup.inviteCodeHint")}
        />
      ) : null}

      <FormField
        label={t("auth.emailLabel")}
        name="email"
        type="email"
        autoComplete="email"
        placeholder={t("auth.emailPlaceholder")}
        defaultValue={emailDefault}
        required
        error={fieldError(state.fieldErrors?.email)}
      />
      <FormField
        label={t("auth.passwordLabel")}
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder={t("auth.passwordPlaceholder")}
        required
        minLength={PASSWORD_MIN_LENGTH}
        error={fieldError(state.fieldErrors?.password)}
        hint={t("auth.signup.passwordHint", { min: PASSWORD_MIN_LENGTH })}
      />

      <SubmitButton pending={pending} pendingLabel={t("auth.signup.submitting")}>
        {t("auth.signup.submit")}
      </SubmitButton>
    </form>
  );
}
