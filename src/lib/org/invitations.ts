/**
 * Team invitations — pure helpers. No I/O.
 *
 * An invite is a row in `organization_invitations` whose creation (owner/admin
 * only, and never for the `owner` role — enforced by RLS + a CHECK) is the
 * authorization gate. The raw token lives only in the emailed link; the table
 * stores its SHA-256 so a DB read can't hand out working links.
 */

import { createHash, randomBytes } from "node:crypto";
import type { OrganizationMemberRole } from "@/lib/supabase/types";

/** Roles an invite may grant. `owner` is deliberately excluded. */
export const INVITABLE_ROLES = ["admin", "manager", "sales", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const INVITE_TTL_HOURS = 168; // 7 days

export function isInvitableRole(value: unknown): value is InvitableRole {
  return typeof value === "string" && (INVITABLE_ROLES as readonly string[]).includes(value);
}

/** A URL-safe, high-entropy invite token (32 bytes). */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of the raw token — what the table stores and what we look up by. */
export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function inviteLink(baseUrl: string, rawToken: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/invite/${rawToken}`;
}

export type InvitationStatus = "pending" | "expired" | "accepted";

export function invitationStatus(
  row: { accepted_at: string | null; expires_at: string },
  now: Date = new Date(),
): InvitationStatus {
  if (row.accepted_at) return "accepted";
  if (Date.parse(row.expires_at) <= now.getTime()) return "expired";
  return "pending";
}

/** Belt-and-braces: the invited role must be one we allow (RLS also blocks 'owner'). */
export function coerceInvitableRole(value: unknown): OrganizationMemberRole | null {
  return isInvitableRole(value) ? (value as OrganizationMemberRole) : null;
}
