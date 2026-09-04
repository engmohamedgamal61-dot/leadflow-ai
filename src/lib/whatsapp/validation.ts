/**
 * Pure validation for the WhatsApp connection form. No secrets, no I/O.
 *
 * Errors are dictionary codes (`whatsapp.validation.*`), never sentences.
 */

export interface WhatsAppConnectionInput {
  phoneNumberId: string;
  accessToken: string;
  wabaId: string;
  displayPhoneNumber: string;
}

export interface ConnectionValidation {
  ok: boolean;
  /** Dotted `whatsapp.validation.*` dictionary keys. */
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
    errors.push("whatsapp.validation.phoneNumberIdNumeric");
  }
  if (clean.accessToken.length < 20 || clean.accessToken.length > 1000) {
    errors.push("whatsapp.validation.accessTokenInvalid");
  }
  if (clean.wabaId && !/^\d{5,32}$/.test(clean.wabaId)) {
    errors.push("whatsapp.validation.wabaIdNumeric");
  }
  if (clean.displayPhoneNumber.length > 32) {
    errors.push("whatsapp.validation.displayNumberTooLong");
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
    return {
      ok: false,
      error: "whatsapp.validation.templateNameFormat",
      clean: null,
    };
  }
  if (!/^[a-zA-Z_]{2,10}$/.test(language)) {
    return {
      ok: false,
      error: "whatsapp.validation.languageCodeInvalid",
      clean: null,
    };
  }
  return { ok: true, clean: { name, language } };
}
