/**
 * Pure input validation for the auth + onboarding forms.
 *
 * No imports, no I/O — safe to unit test under `node --test` and to run on
 * both the client (instant feedback) and the server (the real boundary).
 */

export interface FieldErrors {
  email?: string;
  password?: string;
  name?: string;
  industry?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 8;
export const ORG_NAME_MIN_LENGTH = 2;
export const ORG_NAME_MAX_LENGTH = 200;

export function validateEmail(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.trim() === "") {
    return "Enter your email address.";
  }
  if (raw.trim().length > 320 || !EMAIL_RE.test(raw.trim())) {
    return "Enter a valid email address.";
  }
  return undefined;
}

export function validatePassword(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw === "") {
    return "Enter a password.";
  }
  if (raw.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (raw.length > 72) {
    // bcrypt hard limit — Supabase Auth rejects longer silently-truncated input
    return "Password must be at most 72 characters.";
  }
  return undefined;
}

/** Login only checks that something was entered — the server verifies it. */
export function validateLoginPassword(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw === "") return "Enter your password.";
  return undefined;
}

export function validateOrgName(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.trim() === "") {
    return "Enter your organization name.";
  }
  const trimmed = raw.trim();
  if (trimmed.length < ORG_NAME_MIN_LENGTH) {
    return `Organization name must be at least ${ORG_NAME_MIN_LENGTH} characters.`;
  }
  if (trimmed.length > ORG_NAME_MAX_LENGTH) {
    return `Organization name must be at most ${ORG_NAME_MAX_LENGTH} characters.`;
  }
  return undefined;
}

/**
 * `allowedSlugs` comes from the app's template registry — the caller passes
 * `listIndustryTemplates().map(t => t.slug)` so no industry list is hardcoded
 * here.
 */
export function validateIndustrySlug(
  raw: unknown,
  allowedSlugs: readonly string[],
): string | undefined {
  if (typeof raw !== "string" || raw === "") {
    return "Choose an industry template.";
  }
  if (!allowedSlugs.includes(raw)) {
    return "Choose a valid industry template.";
  }
  return undefined;
}

export interface CredentialsResult {
  ok: boolean;
  fieldErrors: FieldErrors;
  email: string;
  password: string;
}

/** Validate a signup submission (strict password rules). */
export function validateSignup(
  emailRaw: unknown,
  passwordRaw: unknown,
): CredentialsResult {
  const fieldErrors: FieldErrors = {};
  const email = validateEmail(emailRaw);
  const password = validatePassword(passwordRaw);
  if (email) fieldErrors.email = email;
  if (password) fieldErrors.password = password;
  return {
    ok: !email && !password,
    fieldErrors,
    email: typeof emailRaw === "string" ? emailRaw.trim() : "",
    password: typeof passwordRaw === "string" ? passwordRaw : "",
  };
}

/** Validate a login submission (only presence — the server verifies). */
export function validateLogin(
  emailRaw: unknown,
  passwordRaw: unknown,
): CredentialsResult {
  const fieldErrors: FieldErrors = {};
  const email = validateEmail(emailRaw);
  const password = validateLoginPassword(passwordRaw);
  if (email) fieldErrors.email = email;
  if (password) fieldErrors.password = password;
  return {
    ok: !email && !password,
    fieldErrors,
    email: typeof emailRaw === "string" ? emailRaw.trim() : "",
    password: typeof passwordRaw === "string" ? passwordRaw : "",
  };
}

export interface OnboardingResult {
  ok: boolean;
  fieldErrors: FieldErrors;
  name: string;
  industry: string;
}

export function validateOnboarding(
  nameRaw: unknown,
  industryRaw: unknown,
  allowedSlugs: readonly string[],
): OnboardingResult {
  const fieldErrors: FieldErrors = {};
  const name = validateOrgName(nameRaw);
  const industry = validateIndustrySlug(industryRaw, allowedSlugs);
  if (name) fieldErrors.name = name;
  if (industry) fieldErrors.industry = industry;
  return {
    ok: !name && !industry,
    fieldErrors,
    name: typeof nameRaw === "string" ? nameRaw.trim() : "",
    industry: typeof industryRaw === "string" ? industryRaw : "",
  };
}
