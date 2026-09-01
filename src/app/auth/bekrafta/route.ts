/**
 * GET /auth/bekrafta – landningen för Supabase Auth-mejlens länkar
 * (e-postbekräftelse efter registrering, lösenordsåterställning, e-postbyte).
 *
 * Hanterar båda länkstilarna:
 *   * token_hash + type – Supabase-mall med {{ .TokenHash }} (verifyOtp).
 *     Fungerar oavsett vilken webbläsare länken öppnas i.
 *   * code – standardmallens ConfirmationURL: GoTrue verifierar och
 *     redirectar hit med en PKCE-kod (exchangeCodeForSession). Koden kan
 *     bara lösas in i webbläsaren som startade flödet – öppnas länken i en
 *     annan webbläsare visar /login ett tydligt fel i stället.
 *
 * Efter lyckad verifiering finns sessionscookies satta och besökaren skickas
 * till `next` (t.ex. /uppdatera-losenord för återställning) eller "/" – där
 * requireBusiness tar nya användare vidare till /onboarding.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMode } from "@/lib/storage/config";
import { safeAuthNext } from "@/lib/auth/signup-flow";

export const dynamic = "force-dynamic";

const OTP_TYPES: EmailOtpType[] = ["signup", "email", "recovery", "email_change", "invite", "magiclink"];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeAuthNext(params.get("next"));

  if (!isSupabaseMode()) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const tokenHash = params.get("token_hash");
  const rawType = params.get("type");
  const code = params.get("code");
  const supabase = await createSupabaseServerClient();

  if (tokenHash && rawType && OTP_TYPES.includes(rawType as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      type: rawType as EmailOtpType,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    return redirectToLoginWithError(request, error.code);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    return redirectToLoginWithError(request, error.code);
  }

  // GoTrue kan redirecta hit med felparametrar (t.ex. otp_expired) i stället
  // för kod/token – visa samma ärliga fel på /login.
  return redirectToLoginWithError(request, params.get("error_code") ?? undefined);
}

function redirectToLoginWithError(request: NextRequest, code: string | undefined) {
  const url = new URL("/login", request.url);
  url.searchParams.set("bekraftelse", code === "otp_expired" ? "utgangen" : "ogiltig");
  return NextResponse.redirect(url);
}
