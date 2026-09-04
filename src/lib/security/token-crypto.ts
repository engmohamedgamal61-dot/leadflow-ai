/**
 * Generic at-rest token encryption, AES-256-GCM, shared by every integration
 * that stores a provider secret (WhatsApp access token, Google Calendar OAuth
 * tokens, …). Each integration reads its own 64-hex-char (32 byte) key from its
 * own env var — this module is key-agnostic and never reads `process.env`
 * itself, so it stays unit-testable with an injected key.
 *
 * Ciphertext format: `v1.<iv b64>.<authTag b64>.<ciphertext b64>`.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "v1";

function keyBytes(hexKey: string, envVarName: string): Buffer {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) {
    throw new Error(`${envVarName} must be 64 hex characters (32 bytes)`);
  }
  return key;
}

export function encryptToken(
  plaintext: string,
  hexKey: string,
  envVarName = "the encryption key",
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(hexKey, envVarName), iv);
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

export function decryptToken(
  ciphertext: string,
  hexKey: string,
  envVarName = "the encryption key",
): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("malformed encrypted token");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(hexKey, envVarName),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** Read + validate a hex encryption key from env. Throws if missing/invalid. */
export function readHexKeyFromEnv(envVarName: string): string {
  const key = process.env[envVarName];
  if (typeof key !== "string" || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`${envVarName} is missing or not 64 hex characters`);
  }
  return key;
}
