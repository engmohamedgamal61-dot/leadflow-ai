/**
 * Per-endpoint signing-secret lifecycle: generate, hint, encrypt/decrypt.
 *
 * The secret is shown to the user exactly once (on create / rotate) and never
 * again — only the AES-256-GCM ciphertext is stored, column-revoked from
 * `authenticated`, and the dashboard only ever sees `secretHint`.
 *
 * Key: `INTEGRATION_TOKEN_ENCRYPTION_KEY` (64 hex chars). Reuses the generic
 * `token-crypto` helper, same as WhatsApp and Calendar.
 */

import { randomBytes } from "node:crypto";
// Relative `.ts` import so this module (and its unit test) load under `node --test`.
import {
  decryptToken,
  encryptToken,
  readHexKeyFromEnv,
} from "../security/token-crypto.ts";

const ENV_VAR = "INTEGRATION_TOKEN_ENCRYPTION_KEY";
export const SECRET_PREFIX = "whsec_";

/** A fresh signing secret: `whsec_` + 32 random bytes, base64url. */
export function generateEndpointSecret(): string {
  return SECRET_PREFIX + randomBytes(32).toString("base64url");
}

/**
 * Non-sensitive display hint: the prefix, an ellipsis, and the last 6 chars.
 * Enough to tell two secrets apart in the UI, useless to an attacker.
 */
export function secretHint(secret: string): string {
  const tail = secret.slice(-6);
  return `${SECRET_PREFIX}…${tail}`;
}

export function integrationEncryptionKey(): string {
  return readHexKeyFromEnv(ENV_VAR);
}

export function encryptEndpointSecret(secret: string, key = integrationEncryptionKey()): string {
  return encryptToken(secret, key, ENV_VAR);
}

export function decryptEndpointSecret(ciphertext: string, key = integrationEncryptionKey()): string {
  return decryptToken(ciphertext, key, ENV_VAR);
}
