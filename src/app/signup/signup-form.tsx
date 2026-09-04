"use client";

import { useActionState } from "react";
import { signUpAction, type AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";
import { FormField } from "@/components/auth/form-field";
import { FormFeedback, SubmitButton } from "@/components/auth/form-feedback";

const INITIAL: AuthFormState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUpAction, INITIAL);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormFeedback error={state.error} message={state.message} />

      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        error={state.fieldErrors?.email}
      />
      <FormField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="••••••••"
        required
        minLength={PASSWORD_MIN_LENGTH}
        error={state.fieldErrors?.password}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
      />

      <SubmitButton pending={pending} pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
