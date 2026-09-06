/**
 * Team roster for the settings/team page. Owner/admin gated by the page; this
 * reads member rows (RLS session client) and resolves their emails via the
 * Auth admin API (emails aren't exposed to `authenticated` through PostgREST).
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrganizationMemberRole } from "@/lib/supabase/types";

export interface OrgMember {
  userId: string;
  email: string | null;
  role: OrganizationMemberRole;
  isYou: boolean;
  joinedAt: string;
}

export async function listOrgMembers(
  organizationId: string,
  currentUserId: string,
): Promise<OrgMember[]> {
  const db = await createClient();
  const { data } = await db
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  const rows = data ?? [];
  if (rows.length === 0) return [];

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }

  const emails = new Map<string, string | null>();
  if (admin) {
    await Promise.all(
      rows.map(async (r) => {
        try {
          const { data: u } = await admin!.auth.admin.getUserById(r.user_id);
          emails.set(r.user_id, u.user?.email ?? null);
        } catch {
          emails.set(r.user_id, null);
        }
      }),
    );
  }

  return rows.map((r) => ({
    userId: r.user_id,
    email: emails.get(r.user_id) ?? null,
    role: r.role,
    isYou: r.user_id === currentUserId,
    joinedAt: r.created_at,
  }));
}
