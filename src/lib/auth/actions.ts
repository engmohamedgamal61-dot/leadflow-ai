"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  validateLogin,
  validateSignup,
  type FieldErrors,
} from "@/lib/auth/validation";
import { onboardCurrentUser } from "@/lib/org/onboarding";
import { APP_HOME_PATH, ONBOARDING_PATH } from "@/lib/auth/route-policy";

export interface AuthFormState {
  /** Dotted dictionary key for a blocking error. */
  errorCode?: string;
  /** Dotted dictionary key for non-blocking info (e.g. "check your email"). */
  messageCode?: string;
  fieldErrors?: FieldErrors;
}

/** Dictionary code for the Supabase Auth errors we expect from these forms. */
function authErrorCode(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login credentials")) return "auth.errors.invalidCredentials";
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "auth.errors.emailExists";
  }
  if (m.includes("email not confirmed")) return "auth.errors.emailNotConfirmed";
  if (m.includes("rate limit") || m.includes("too many")) return "auth.errors.rateLimited";
  if (m.includes("password")) return "auth.errors.weakPassword";
  return "auth.errors.generic";
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateSignup(formData.get("email"), formData.get("password"));
  if (!parsed.ok) {
    return { errorCode: "validation.fixHighlighted", fieldErrors: parsed.fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.email,
    password: parsed.password,
  });

  if (error) {
    return { errorCode: authErrorCode(error.message) };
  }

  // Confirmations off (local / no-SMTP) → a session is issued immediately.
  // Confirmations on (production) → no session until the user clicks the link.
  if (!data.session) {
    return { messageCode: "auth.signup.checkEmail" };
  }

  redirect(ONBOARDING_PATH);
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateLogin(formData.get("email"), formData.get("password"));
  if (!parsed.ok) {
    return { errorCode: "validation.fixHighlighted", fieldErrors: parsed.fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.email,
    password: parsed.password,
  });

  if (error) {
    return { errorCode: authErrorCode(error.message) };
  }

  // `/dashboard` sends the user on to `/onboarding` if they have no org yet.
  redirect(APP_HOME_PATH);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export interface OnboardingFormState {
  errorCode?: string;
  fieldErrors?: FieldErrors;
}

export async function onboardAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const outcome = await onboardCurrentUser(
    formData.get("name"),
    formData.get("industry"),
  );

  if (outcome.status === "error") {
    return { errorCode: outcome.errorCode, fieldErrors: outcome.fieldErrors };
  }

  // "created" and "already-member" both land on the app.
  redirect(APP_HOME_PATH);
}
