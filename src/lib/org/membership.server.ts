import { createClient } from "@/lib/supabase/server";
import {
  toMembership,
  type MembershipJoinRow,
  type UserMembership,
} from "@/lib/org/membership";

/**
 * Load the current user's membership (RLS-scoped — the query can only ever see
 * the caller's own rows). `null` when the user has no organization yet, when
 * there is no session, or when Supabase isn't configured.
 *
 * One organization per user for now (enforced by the onboarding RPC), so the
 * first row is authoritative.
 */
export async function getUserMembership(
  userId: string,
): Promise<UserMembership | null> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase
    .from("organization_members")
    .select(
      "role, organizations ( id, name, slug, industry_template_id, status )",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return toMembership(data[0] as unknown as MembershipJoinRow);
}
