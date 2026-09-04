import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "@/lib/auth/route-policy";

/**
 * The authenticated user for the current request, or `null`.
 *
 * `getUser()` validates the token with the Auth server — never `getSession()`
 * for an authorization decision.
 */
export async function getSessionUser(): Promise<User | null> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return null;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Server-Component / Server-Action guard. Redirects to `/login` when there is
 * no session. The proxy already gates protected routes; this is the
 * defence-in-depth re-check the Next.js data-security guidance calls for.
 */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}
