/**
 * GET /demo – "Se demo": rakt in i produkten som Södermalms Snickeri AB.
 *
 * Ingen mellansida, inget konto och INGEN databas: routen sätter en
 * httpOnly-cookie med ett kryptografiskt slumpat session-id och klonar det
 * kanoniska exempeldatat till besökarens egen JSON-fil
 * (.data/demo-sessions/<id>.json). Ett återbesök inom sessionens livslängd
 * återanvänder samma fil – ändringarna finns kvar. Incognito/annan
 * webbläsare = ny cookie = egen färsk klon.
 *
 * Vakter:
 *   * Prefetch/spekulativa hämtningar startar aldrig en session (204).
 *   * Rate limit per IP + instans (drygt för människor, stopp för skript).
 *   * Redan inloggade riktiga användare skickas till sin app – deras
 *     session röres aldrig, och demon rör aldrig Supabase.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseMode } from "@/lib/storage/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEMO_SESSION_COOKIE,
  clientIpFrom,
  isDemoCookieValueActive,
  rateLimitDemoStart,
} from "@/lib/auth/demo-session";
import { startDemoSession } from "@/lib/auth/demo-request";

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
  if (isSpeculativeFetch(request)) {
    return new NextResponse(null, { status: 204 });
  }

  if (isSupabaseMode()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      // En inloggad riktig användare har redan hela produkten.
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // Aktiv demosession: fortsätt där besökaren var (samma fil).
  if (isDemoCookieValueActive(request.cookies.get(DEMO_SESSION_COOKIE)?.value)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!rateLimitDemoStart(clientIpFrom(request.headers))) {
    return NextResponse.redirect(new URL("/login?demo=upptagen", request.url));
  }

  // Cookien skrivs via cookies() i route handler-kontext och följer med
  // redirect-svaret nedan. Seedet klonas till sessionens egen JSON-fil.
  await startDemoSession();
  return NextResponse.redirect(new URL("/", request.url));
}
