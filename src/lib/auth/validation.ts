/**
 * Pure input validation for the auth + onboarding forms.
 *
 * No imports, no I/O — safe to unit test under `node --test` and to run on
 * both the client (instant feedback) and the server (the real boundary).
 *
 * Errors are returned as **codes** (+ optional params), never user-facing
 * sentences. The UI resolves them against the `validation.*` dictionary so the
 * same validator serves both locales.
 */

export interface ValidationError {
  /** Dotted key under the `validation.*` dictionary namespace. */
  code: string;
  params?: Record<string, string | number>;
}

export interface FieldErrors {
  email?: ValidationError;
  password?: ValidationError;
  name?: ValidationError;
  industry?: ValidationError;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const ORG_NAME_MIN_LENGTH = 2;
export const ORG_NAME_MAX_LENGTH = 200;

export function validateEmail(raw: unknown): ValidationError | undefined {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { code: "email.required" };
  }
  if (raw.trim().length > 320 || !EMAIL_RE.test(raw.trim())) {
    return { code: "email.invalid" };
  }
  return undefined;
}

export function validatePassword(raw: unknown): ValidationError | undefined {
  if (typeof raw !== "string" || raw === "") {
    return { code: "password.required" };
  }
  if (raw.length < PASSWORD_MIN_LENGTH) {
    return { code: "password.tooShort", params: { min: PASSWORD_MIN_LENGTH } };
  }
  if (raw.length > PASSWORD_MAX_LENGTH) {
    // bcrypt hard limit — Supabase Auth rejects longer silently-truncated input
    return { code: "password.tooLong", params: { max: PASSWORD_MAX_LENGTH } };
  }
  return undefined;
}

/** Login only checks that something was entered — the server verifies it. */
export function validateLoginPassword(raw: unknown): ValidationError | undefined {
  if (typeof raw !== "string" || raw === "") return { code: "password.loginRequired" };
  return undefined;
}

export function validateOrgName(raw: unknown): ValidationError | undefined {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { code: "orgName.required" };
  }
  const trimmed = raw.trim();
  if (trimmed.length < ORG_NAME_MIN_LENGTH) {
    return { code: "orgName.tooShort", params: { min: ORG_NAME_MIN_LENGTH } };
  }
  if (trimmed.length > ORG_NAME_MAX_LENGTH) {
    return { code: "orgName.tooLong", params: { max: ORG_NAME_MAX_LENGTH } };
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
): ValidationError | undefined {
  if (typeof raw !== "string" || raw === "") {
    return { code: "industry.required" };
  }
  if (!allowedSlugs.includes(raw)) {
    return { code: "industry.invalid" };
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
