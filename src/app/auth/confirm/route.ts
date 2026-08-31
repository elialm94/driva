/**
 * Landningspunkt för länkarna i Supabase-auth-mejlen (bekräfta e-post,
 * återställ lösenord). Växlar engångskoden till en session och skickar
 * användaren vidare – nya konton till onboarding, annars till next.
 *
 * Två varianter stöds:
 *   * ?code=…                 – standardlänken (PKCE): exchangeCodeForSession.
 *   * ?token_hash=…&type=…    – anpassad mejlmall: verifyOtp, fungerar även
 *                               i en annan webbläsare än där kontot skapades.
 *
 * Misslyckad växling (utgången länk, annan webbläsare utan verifier) landar
 * på /login med en förklaring – aldrig en rå felsida.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeAuthNext } from "@/lib/auth/signup-flow";
import { isSupabaseMode } from "@/lib/storage/config";

export const dynamic = "force-dynamic";

const OTP_TYPES: EmailOtpType[] = ["signup", "email", "recovery", "email_change", "invite", "magiclink"];

function parseOtpType(raw: string | null): EmailOtpType | null {
  return raw && (OTP_TYPES as string[]).includes(raw) ? (raw as EmailOtpType) : null;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeAuthNext(url.searchParams.get("next"));
  const redirectTo = (pathname: string, params?: Record<string, string>) => {
    const dest = url.clone();
    dest.pathname = pathname;
    dest.search = "";
    for (const [k, v] of Object.entries(params ?? {})) dest.searchParams.set(k, v);
    return NextResponse.redirect(dest);
  };

  if (!isSupabaseMode()) return redirectTo("/");

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = parseOtpType(url.searchParams.get("type"));

  const supabase = await createSupabaseServerClient();
  let verified = false;
  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash });
    verified = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  }

  if (!verified) {
    // Länken kan redan ha förbrukats i en annan flik – har besökaren en
    // session är verifieringen i praktiken klar. Annars: logga in manuellt.
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) verified = true;
  }

  if (!verified) {
    return redirectTo("/login", { lank: "ogiltig" });
  }

  // Nya konton fortsätter till onboarding (som själv skickar vidare till
  // appen om ett företag redan finns). Explicit next (t.ex. inbjudan eller
  // lösenordsåterställning) vinner.
  return redirectTo(next !== "/" ? next : "/onboarding");
}
