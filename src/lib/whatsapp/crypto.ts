/**
 * At-rest encryption for WhatsApp access tokens. AES-256-GCM with a key from
 * the server-only `WHATSAPP_TOKEN_ENCRYPTION_KEY` env (64 hex chars = 32
 * bytes). Not a KMS, but the token is also RLS-scoped, column-revoked from the
 * browser, and never logged — appropriate for the MVP.
 *
 * Ciphertext format: `v1.<iv b64>.<authTag b64>.<ciphertext b64>`.
 * This module does not read env directly beyond the key helper so it stays
 * unit-testable with an injected key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "v1";

function keyBytes(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) {
    throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return key;
}

export function encryptToken(plaintext: string, hexKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(hexKey), iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

export function decryptToken(ciphertext: string, hexKey: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("malformed encrypted token");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(hexKey),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** Read + validate the encryption key from env. Throws if missing/invalid. */
export function tokenEncryptionKey(): string {
  const key = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (typeof key !== "string" || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "WHATSAPP_TOKEN_ENCRYPTION_KEY is missing or not 64 hex characters",
    );
  }
  return key;
}
