"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { requireUser } from "@/lib/auth/session";
import { validateEmail } from "@/lib/auth/validation";
import { appBaseUrlOrNull } from "@/lib/app-url";
import { inviteLink, isInvitableRole } from "@/lib/org/invitations";
import {
  createInvitation,
  revokeInvitation,
  acceptInvitation,
} from "@/lib/org/invitations.server";
import { APP_HOME_PATH } from "@/lib/auth/route-policy";

export interface InviteFormState {
  ok?: boolean;
  errorCode?: string;
  /** The generated link — surfaced for the admin to send (pilot: no SMTP dependency). */
  inviteLink?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createInviteAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const { user, membership } = await requireOrganizationContext();
  if (!canManageConfig(membership.role)) {
    return { errorCode: "team.errors.notAllowed" };
  }

  const emailErr = validateEmail(formData.get("email"));
  if (emailErr) return { errorCode: `validation.${emailErr.code}` };

  const role = String(formData.get("role") ?? "");
  if (!isInvitableRole(role)) return { errorCode: "team.errors.invalidRole" };

  const db = await createClient();
  const outcome = await createInvitation(db, {
    organizationId: membership.organizationId,
    email: String(formData.get("email")),
    role,
    invitedBy: user.id,
  });

  if (outcome.status === "already_pending") {
    return { errorCode: "team.errors.alreadyInvited" };
  }
  if (outcome.status !== "created") {
    return { errorCode: "team.errors.createFailed" };
  }

  revalidatePath("/dashboard/settings/team");
  const base = appBaseUrlOrNull();
  return {
    ok: true,
    inviteLink: base ? inviteLink(base, outcome.rawToken) : `/invite/${outcome.rawToken}`,
  };
}

export async function revokeInviteAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const { membership } = await requireOrganizationContext();
  if (!canManageConfig(membership.role)) {
    return { errorCode: "team.errors.notAllowed" };
  }
  const id = String(formData.get("invitationId") ?? "");
  if (!UUID_RE.test(id)) return { errorCode: "team.errors.createFailed" };

  const db = await createClient();
  const ok = await revokeInvitation(db, membership.organizationId, id);
  if (!ok) return { errorCode: "team.errors.createFailed" };
  revalidatePath("/dashboard/settings/team");
  return { ok: true };
}

export interface AcceptInviteState {
  errorCode?: string;
}

const ACCEPT_ERROR_CODE: Record<string, string> = {
  wrong_email: "invite.errors.wrongEmail",
  in_another_org: "invite.errors.inAnotherOrg",
  expired: "invite.errors.expired",
  not_found: "invite.errors.notFound",
  failed: "invite.errors.failed",
};

export async function acceptInviteAction(
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const user = await requireUser();
  const rawToken = String(formData.get("token") ?? "");

  const result = await acceptInvitation(createAdminClient(), rawToken, {
    id: user.id,
    email: user.email,
  });

  if (result.status === "accepted" || result.status === "already_member") {
    redirect(APP_HOME_PATH);
  }
  return { errorCode: ACCEPT_ERROR_CODE[result.status] ?? "invite.errors.failed" };
}
