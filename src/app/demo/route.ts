/**
 * GET /demo – "Se demo": rakt in i produkten som Södermalms Snickeri AB.
 *
 * Ingen mellansida, inget konto: routen provisionerar en isolerad
 * demosession (anonym Supabase-användare + eget demoföretag + exempeldata)
 * och skickar besökaren direkt till appens Hem. Ett återbesök inom en aktiv
 * session återanvänder den – ändringarna finns kvar. Incognito/annan
 * webbläsare = nya cookies = egen färsk demo.
 *
 * Vakter:
 *   * Prefetch/spekulativa hämtningar provisionerar aldrig (204).
 *   * Rate limit per IP + instans (drygt för människor, stopp för skript).
 *   * Redan inloggade riktiga användare skickas till sin app – deras
 *     session röres aldrig.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseMode } from "@/lib/storage/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEMO_SESSION_COOKIE,
  clientIpFrom,
  isDemoClaims,
  isDemoCookieValueActive,
  rateLimitDemoStart,
} from "@/lib/auth/demo-session";
import {
  clearDemoCookies,
  hasDemoMembership,
  provisionDemoSession,
} from "@/lib/auth/demo-provision";

export const dynamic = "force-dynamic";

function isSpeculativeFetch(request: NextRequest): boolean {
  const purpose = `${request.headers.get("sec-purpose") ?? ""} ${request.headers.get("purpose") ?? ""}`;
  return (
    purpose.includes("prefetch") ||
    purpose.includes("prerender") ||
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("next-router-segment-prefetch") !== null
  );
}

export async function GET(request: NextRequest) {
  // JSON-läget (lokal utveckling) ÄR demon – rakt in i appen.
  if (!isSupabaseMode()) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isSpeculativeFetch(request)) {
    return new NextResponse(null, { status: 204 });
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (claims?.sub && !isDemoClaims(claims)) {
    // En inloggad riktig användare har redan hela produkten.
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (claims?.sub && isDemoClaims(claims)) {
    const cookieValue = request.cookies.get(DEMO_SESSION_COOKIE)?.value;
    if (isDemoCookieValueActive(cookieValue) && (await hasDemoMembership(String(claims.sub)))) {
      // Aktiv demosession: fortsätt där besökaren var.
      return NextResponse.redirect(new URL("/", request.url));
    }
    // Utgången/halv session: släpp tokens och provisionera en färsk demo.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    await clearDemoCookies().catch(() => undefined);
  }

  if (!rateLimitDemoStart(clientIpFrom(request.headers))) {
    return NextResponse.redirect(new URL("/login?demo=upptagen", request.url));
  }

  // Cookie-skrivningarna (Supabase-tokens + demo-cookien) går via cookies()
  // i route handler-kontext och följer med redirect-svaret nedan.
  const result = await provisionDemoSession();
  if (!result.ok) {
    return NextResponse.redirect(
      new URL(result.reason === "unavailable" ? "/login?demo=stangd" : "/login?demo=fel", request.url)
    );
  }
  return NextResponse.redirect(new URL("/", request.url));
}
