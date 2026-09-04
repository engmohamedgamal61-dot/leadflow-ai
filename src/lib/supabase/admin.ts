import { createClient as createSupabaseClient } from "@supabase/supabase-js";
// Relative so this module (and anything that imports it) can run under
// `node --test`, which does not resolve the `@/` alias for value imports.
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./env.ts";
import type { Database } from "@/lib/supabase/types";

/**
 * Service-role Supabase client. **Bypasses Row Level Security** and must only
 * be used server-side for trusted operations (migrations tooling, onboarding,
 * background jobs — all later phases).
 *
 * `getSupabaseServiceRoleKey()` throws if called in the browser, so this file
 * cannot be used from Client Components.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
