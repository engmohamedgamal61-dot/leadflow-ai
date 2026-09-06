/**
 * Team-invitation I/O. Not a `"use server"` module — the server actions in
 * `invitation-actions.ts` wrap these after their auth/role checks; the
 * `/invite/<token>` page reads through them too.
 *
 * Creation runs on the caller's RLS session client (the insert policy is the
 * real gate). Acceptance runs on the service-role client because the invitee
 * isn't a member yet — but only after re-validating the token, the invitee's
 * own email, one-org-per-user, and that the role is invitable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  coerceInvitableRole,
  generateInviteToken,
  hashInviteToken,
  invitationStatus,
  INVITE_TTL_HOURS,
  type InvitationStatus,
} from "./invitations.ts";
// Relative value imports so this module (and its integration test) load under
// `node --test`. `@/`-aliased type-only imports are erased and stay fine.
import { reportError } from "../observability/report.ts";

type Db = SupabaseClient<Database>;

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
}

export interface InvitationForAcceptance {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: string;
  status: InvitationStatus;
}

export type CreateInvitationResult =
  | { status: "created"; rawToken: string }
  | { status: "already_pending" }
  | { status: "invalid_role" }
  | { status: "failed" };

/** Session client — the RLS insert policy (owner/admin) is the authorization gate. */
export async function createInvitation(
  db: Db,
  input: { organizationId: string; email: string; role: string; invitedBy: string },
): Promise<CreateInvitationResult> {
  const role = coerceInvitableRole(input.role);
  if (!role) return { status: "invalid_role" };

  const rawToken = generateInviteToken();
  const { error } = await db.from("organization_invitations").insert({
    organization_id: input.organizationId,
    email: input.email.trim().toLowerCase(),
    role,
    token_hash: hashInviteToken(rawToken),
    invited_by: input.invitedBy,
    expires_at: new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000).toISOString(),
  });

  if (error) {
    if ((error as { code?: string }).code === "23505") return { status: "already_pending" };
    void reportError(error, { scope: "invitations.create" });
    return { status: "failed" };
  }
  return { status: "created", rawToken };
}

/** Session client — RLS scopes to owner/admin of the org. */
export async function listInvitations(
  db: Db,
  organizationId: string,
): Promise<InvitationRow[]> {
  const { data, error } = await db
    .from("organization_invitations")
    .select("id, email, role, accepted_at, expires_at, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: invitationStatus(r),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

/** Session client — RLS delete policy is owner/admin. */
export async function revokeInvitation(
  db: Db,
  organizationId: string,
  invitationId: string,
): Promise<boolean> {
  const { error } = await db
    .from("organization_invitations")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", invitationId);
  return !error;
}

/** Admin client — the invitee isn't a member, so RLS can't authorise this read. */
export async function getInvitationByToken(
  admin: Db,
  rawToken: string,
): Promise<InvitationForAcceptance | null> {
  if (typeof rawToken !== "string" || rawToken.length < 20) return null;
  const { data } = await admin
    .from("organization_invitations")
    .select("id, organization_id, email, role, accepted_at, expires_at, organizations ( name )")
    .eq("token_hash", hashInviteToken(rawToken))
    .maybeSingle();
  if (!data) return null;
  const org = (data as { organizations?: { name: string } | null }).organizations;
  return {
    id: data.id,
    organizationId: data.organization_id,
    organizationName: org?.name ?? "",
    email: data.email,
    role: data.role,
    status: invitationStatus(data),
  };
}

export type AcceptInvitationResult =
  | { status: "accepted"; organizationId: string }
  | { status: "already_member"; organizationId: string }
  | { status: "wrong_email" }
  | { status: "in_another_org" }
  | { status: "expired" }
  | { status: "not_found" }
  | { status: "failed" };

/**
 * Admin client. Re-validates everything before adding the member:
 *  - the token resolves to a still-pending invite,
 *  - the invite's email matches the signed-in user's (case-insensitive),
 *  - the role is invitable (defence — the CHECK constraint blocks 'owner'),
 *  - the user isn't already in a different organization,
 *  - the invite is claimed atomically so a token is single-use.
 */
export async function acceptInvitation(
  admin: Db,
  rawToken: string,
  user: { id: string; email: string | undefined },
): Promise<AcceptInvitationResult> {
  const invite = await getInvitationByToken(admin, rawToken);
  if (!invite) return { status: "not_found" };
  if (invite.status === "expired") return { status: "expired" };
  if (invite.status === "accepted") {
    // Already used — if it was this user for this org, treat as success.
    return { status: "already_member", organizationId: invite.organizationId };
  }

  const inviteEmail = invite.email.trim().toLowerCase();
  const userEmail = (user.email ?? "").trim().toLowerCase();
  if (!userEmail || userEmail !== inviteEmail) return { status: "wrong_email" };

  const role = coerceInvitableRole(invite.role);
  if (!role) return { status: "failed" };

  // One organization per user.
  const { data: existing } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id);
  const already = (existing ?? []).map((r) => r.organization_id);
  if (already.length > 0) {
    if (already.includes(invite.organizationId)) {
      // Close the invite so it doesn't linger.
      await admin
        .from("organization_invitations")
        .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
        .eq("id", invite.id)
        .is("accepted_at", null);
      return { status: "already_member", organizationId: invite.organizationId };
    }
    return { status: "in_another_org" };
  }

  // Claim the invite atomically first — makes the token single-use.
  const { data: claimed, error: claimErr } = await admin
    .from("organization_invitations")
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq("id", invite.id)
    .is("accepted_at", null)
    .select("id");
  if (claimErr || !claimed || claimed.length === 0) {
    return { status: "already_member", organizationId: invite.organizationId };
  }

  const { error: memberErr } = await admin
    .from("organization_members")
    .upsert(
      { organization_id: invite.organizationId, user_id: user.id, role },
      { onConflict: "organization_id,user_id", ignoreDuplicates: true },
    );
  if (memberErr) {
    void reportError(memberErr, { scope: "invitations.accept" });
    return { status: "failed" };
  }

  return { status: "accepted", organizationId: invite.organizationId };
}
