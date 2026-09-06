/**
 * Pilot signup gate — a server-side control to keep public signup closed
 * during a controlled pilot.
 *
 * When `SIGNUP_INVITE_CODE` is set, a new signup must supply a matching code
 * (compared in constant time). When it's unset, signup is open (unchanged
 * behaviour). Team invitations are exempt — they carry their own token.
 *
 * No dependency, no I/O: safe to call from the signup server action and to
 * unit test.
 */

// Relative value import so this module (and its test) load under `node --test`.
import { timingSafeEqual } from "../follow-ups/auth.ts";

/** True when a signup invite code is required. */
export function isSignupGated(): boolean {
  const code = process.env.SIGNUP_INVITE_CODE;
  return typeof code === "string" && code.trim().length > 0;
}

/** Validate a submitted signup code against `SIGNUP_INVITE_CODE`. */
export function checkSignupInviteCode(submitted: unknown): boolean {
  const expected = process.env.SIGNUP_INVITE_CODE;
  if (typeof expected !== "string" || expected.trim().length === 0) return true;
  if (typeof submitted !== "string") return false;
  return timingSafeEqual(submitted.trim(), expected.trim());
}
