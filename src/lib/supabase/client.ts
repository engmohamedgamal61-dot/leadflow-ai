import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Supabase client for the browser (Client Components).
 *
 * `createBrowserClient` is safe to call repeatedly — the SDK memoises a single
 * instance per page. Only the public URL + anon key are used; all access is
 * still gated by Row Level Security.
 */
export function createClient() {
  return createBrowserClient<Database>(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
  );
}
