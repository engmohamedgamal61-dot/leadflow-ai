import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Supabase client for the server (Route Handlers, Server Components, Server
 * Actions), scoped to the current request's cookies.
 *
 * A **new client is created per call** — never cache this at module scope, or
 * one request's session could leak into another.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` was called from a Server Component, where cookies are
          // read-only. Session refresh is handled elsewhere (middleware, once
          // auth lands) so this can be safely ignored.
        }
      },
    },
  });
}
