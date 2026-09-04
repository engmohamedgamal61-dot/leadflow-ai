import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/types";
import type { User } from "@supabase/supabase-js";

/**
 * Refresh the Supabase session for an incoming proxy request.
 *
 * Creates a request-scoped Supabase client whose cookie writes land on a fresh
 * `NextResponse`, calls `getUser()` (which rotates an expiring access token and
 * re-issues the cookies), and hands both back. The caller returns `response`
 * so the refreshed cookies reach the browser — or copies its `Set-Cookie`
 * headers onto a redirect.
 *
 * Only the public URL + anon key are used; the service-role key never touches
 * this path.
 */
export async function refreshSession(request: NextRequest): Promise<{
  response: NextResponse;
  user: User | null;
}> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: `getUser()` (not `getSession()`) — it validates the token with
  // the Auth server, so the result can be trusted for an access decision.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

/** Carry the refreshed auth cookies from `source` onto a redirect response. */
export function withAuthCookies(
  target: NextResponse,
  source: NextResponse,
): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}
