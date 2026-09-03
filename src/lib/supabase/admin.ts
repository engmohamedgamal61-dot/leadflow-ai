import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/supabase/env";
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
