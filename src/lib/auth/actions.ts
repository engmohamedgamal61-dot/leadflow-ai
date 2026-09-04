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
  error?: string;
  /** Non-blocking info (e.g. "check your email"). */
  message?: string;
  fieldErrors?: FieldErrors;
}

/** Friendly text for the Supabase Auth errors we expect from these forms. */
function authErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "An account with that email already exists. Try signing in.";
  }
  if (m.includes("email not confirmed")) {
    return "Please confirm your email address before signing in.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (m.includes("password")) {
    return "That password is not allowed. Choose a stronger one.";
  }
  return "Authentication failed. Please try again.";
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateSignup(formData.get("email"), formData.get("password"));
  if (!parsed.ok) {
    return { error: "Please fix the highlighted fields.", fieldErrors: parsed.fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.email,
    password: parsed.password,
  });

  if (error) {
    return { error: authErrorMessage(error.message) };
  }

  // Confirmations off (local / no-SMTP) → a session is issued immediately.
  // Confirmations on (production) → no session until the user clicks the link.
  if (!data.session) {
    return {
      message:
        "Check your email for a confirmation link, then sign in to continue.",
    };
  }

  redirect(ONBOARDING_PATH);
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = validateLogin(formData.get("email"), formData.get("password"));
  if (!parsed.ok) {
    return { error: "Please fix the highlighted fields.", fieldErrors: parsed.fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.email,
    password: parsed.password,
  });

  if (error) {
    return { error: authErrorMessage(error.message) };
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
  error?: string;
  fieldErrors?: Record<string, string>;
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
    return { error: outcome.message, fieldErrors: outcome.fieldErrors };
  }

  // "created" and "already-member" both land on the app.
  redirect(APP_HOME_PATH);
}
