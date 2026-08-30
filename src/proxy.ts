/**
 * Proxy (Next 16-namnet för middleware): sessionsuppfriskning + ruttskydd.
 *
 *   * Friskar upp utgången Supabase-session på varje request (getClaims →
 *     nya cookies skrivs till svaret) så att inloggningen är beständig.
 *   * Oautentiserade requests till appens skyddade rutter skickas till
 *     /login?next=<ursprunglig sökväg> och tillbaka efter inloggning.
 *   * Publika ytor (offert-/fakturalänkar, kundsajt, BankID-API) släpps
 *     igenom orörda – de auktoriseras med ogissbara tokens på serversidan.
 *
 * Utan Supabase-miljö (lokal JSON-utveckling) är proxyn passiv.
 * OBS: Detta är första försvarslinjen för UX – den riktiga auktoriseringen
 * sker alltid på serversidan (withBusiness + RLS), aldrig bara här.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/offert",
  "/faktura",
  "/sajt",
  "/inbjudan",
  "/api/bankid",
  "/api/inbox",
  "/api/dev", // vaktas internt: endast utveckling
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return NextResponse.next(); // JSON-läge (endast utveckling)

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Verifierar sessionen (och friskar upp den vid behov – setAll ovan).
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!isAuthenticated && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const next = `${pathname}${search}`;
    if (next !== "/" && !next.startsWith("/login") && !next.startsWith("/signup")) {
      loginUrl.searchParams.set("next", next);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthenticated && (pathname === "/login" || pathname === "/signup")) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  // Hoppa över statiska filer och bildoptimering. Allt annat passerar proxyn.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
