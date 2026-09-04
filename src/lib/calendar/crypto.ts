/**
 * At-rest encryption for Google Calendar OAuth tokens. Thin wrapper over the
 * shared `lib/security/token-crypto.ts` AES-256-GCM helper, keyed by the
 * server-only `CALENDAR_TOKEN_ENCRYPTION_KEY` env (64 hex chars = 32 bytes).
 */

import {
  decryptToken as decrypt,
  encryptToken as encrypt,
  readHexKeyFromEnv,
} from "../security/token-crypto.ts";

const ENV_VAR = "CALENDAR_TOKEN_ENCRYPTION_KEY";

export function encryptToken(plaintext: string, hexKey: string): string {
  return encrypt(plaintext, hexKey, ENV_VAR);
}

export function decryptToken(ciphertext: string, hexKey: string): string {
  return decrypt(ciphertext, hexKey, ENV_VAR);
}

/** Read + validate the encryption key from env. Throws if missing/invalid. */
export function tokenEncryptionKey(): string {
  return readHexKeyFromEnv(ENV_VAR);
}
