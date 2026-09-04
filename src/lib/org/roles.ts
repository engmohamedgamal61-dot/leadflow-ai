/**
 * Pure role helpers. These mirror the database RLS write policies so the UI can
 * hide controls a user can't use — they are a UX convenience, NEVER the
 * security boundary. Every mutation still runs under the user's RLS-scoped
 * session client, which is the real gate.
 */

export const LEAD_WRITE_ROLES = ["owner", "admin", "manager", "sales"] as const;
export const LEAD_MANAGE_ROLES = ["owner", "admin", "manager"] as const;

/** Matches the `leads_update_writers` / `conversations_*_writers` RLS policy. */
export function canWriteLeads(role: string): boolean {
  return (LEAD_WRITE_ROLES as readonly string[]).includes(role);
}

/** Matches the `leads_delete_admins` RLS policy (broader lead management). */
export function canManageLeads(role: string): boolean {
  return (LEAD_MANAGE_ROLES as readonly string[]).includes(role);
}
