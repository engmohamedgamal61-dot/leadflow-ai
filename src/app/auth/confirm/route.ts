import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ONBOARDING_PATH } from "@/lib/auth/route-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase email confirmation / magic-link callback.
 *
 * The confirmation email links here with `?token_hash=&type=`. We verify the
 * OTP (which sets the session cookies) and redirect onward. Used only when
 * email confirmations are enabled (production); harmless otherwise.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? ONBOARDING_PATH;
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : ONBOARDING_PATH;

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=expired_link", request.url));
  }

  return NextResponse.redirect(new URL(safeNext, request.url));
}
