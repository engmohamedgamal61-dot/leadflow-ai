import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ONBOARDING_PATH } from "@/lib/auth/route-policy";
import { safeNextPath } from "@/lib/auth/next-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase email callback — confirmation, magic link, and password recovery.
 *
 * Handles both flows Supabase may use depending on project settings /
 * version: a PKCE `?code=` (exchanged for a session) or an OTP
 * `?token_hash=&type=` (verified). Either sets the session cookies, then we
 * redirect to `next` (recovery → `/reset-password`; otherwise onboarding).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const safeNext = safeNextPath(searchParams.get("next"), ONBOARDING_PATH);

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=expired_link", request.url));
    }
    return NextResponse.redirect(new URL(safeNext, request.url));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      return NextResponse.redirect(new URL("/login?error=expired_link", request.url));
    }
    return NextResponse.redirect(new URL(safeNext, request.url));
  }

  return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
}
