/**
 * Pure validation for the WhatsApp connection form. No secrets, no I/O.
 */

export interface WhatsAppConnectionInput {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string;
  displayPhoneNumber: string;
}

export interface ConnectionValidation {
  ok: boolean;
  errors: string[];
  clean: WhatsAppConnectionInput;
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function validateConnectionInput(raw: {
  phoneNumberId?: unknown;
  accessToken?: unknown;
  wabaId?: unknown;
  displayPhoneNumber?: unknown;
}): ConnectionValidation {
  const clean: WhatsAppConnectionInput = {
    phoneNumberId: s(raw.phoneNumberId),
    accessToken: s(raw.accessToken),
    wabaId: s(raw.wabaId),
    displayPhoneNumber: s(raw.displayPhoneNumber),
  };
  const errors: string[] = [];

  if (!/^\d{5,32}$/.test(clean.phoneNumberId)) {
    errors.push("Phone number ID must be numeric (from the Meta dashboard).");
  }
  if (clean.accessToken.length < 20 || clean.accessToken.length > 1000) {
    errors.push("Access token looks invalid.");
  }
  if (clean.wabaId && !/^\d{5,32}$/.test(clean.wabaId)) {
    errors.push("WABA ID must be numeric.");
  }
  if (clean.displayPhoneNumber.length > 32) {
    errors.push("Display phone number is too long.");
  }

  return { ok: errors.length === 0, errors, clean };
}

export interface FollowUpTemplateInput {
  name: string;
  language: string;
}

export function validateFollowUpTemplate(raw: {
  name?: unknown;
  language?: unknown;
}): { ok: boolean; error?: string; clean: FollowUpTemplateInput | null } {
  const name = s(raw.name);
  const language = s(raw.language) || "en_US";
  if (!name) return { ok: true, clean: null }; // clearing the template
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    return { ok: false, error: "Template name must be lowercase letters, digits and underscores.", clean: null };
  }
  if (!/^[a-zA-Z_]{2,10}$/.test(language)) {
    return { ok: false, error: "Language code looks invalid (e.g. en_US, ar).", clean: null };
  }
  return { ok: true, clean: { name, language } };
}
