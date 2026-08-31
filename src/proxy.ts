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
import {
  DEMO_ACTOR_COOKIE,
  DEMO_SESSION_COOKIE,
  isDemoCookieValueActive,
  isDemoUserEmail,
} from "@/lib/auth/demo-session";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/glomt-losenord",
  "/auth/confirm", // mejllänkarnas landningspunkt: växlar kod → session
  "/demo", // publik demo-entré: startar en isolerad demosession direkt
  "/offert",
  "/faktura",
  "/sajt",
  "/integritetspolicy",
  "/villkor",
  "/integritet",
  "/valkommen", // landningssidans interna sökväg (rewrite-mål för "/")
  "/inbjudan",
  "/api/health", // driftdiagnostik: måste nås utan inloggning när appen är trasig
  "/admin/inbjudan", // admin-invitationens acceptsida: mottagaren saknar ofta konto ännu
  "/api/bankid",
  "/api/inbox",
  "/api/dev", // vaktas internt: endast utveckling
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Next.js prefetch – inte en riktig navigering. */
function isRouterPrefetch(request: NextRequest): boolean {
  return (
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("next-router-segment-prefetch") !== null
  );
}

export async function proxy(request: NextRequest) {
  try {
    return await runSessionProxy(request);
  } catch {
    // En kastad getClaims/nätverksmiss ska inte ge "This page couldn't load".
    // Sidans requireUser/ensurePageBusiness är den riktiga auktoriseringen.
    return NextResponse.next({ request });
  }
}

async function runSessionProxy(request: NextRequest) {
  // Prefetch ska inte friska session eller redirecta – det har på Vercel
  // timeoutat och lämnat avhuggna RSC-payloads till klientcachen.
  if (isRouterPrefetch(request)) return NextResponse.next({ request });

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

  // Demosessioner är tidsbegränsade: utan giltig demo-cookie loggas
  // demo-användarens session ut (endast DENNA besökares tokens – scope local)
  // och besökaren landar på /demo igen. Riktiga användare berörs aldrig.
  if (isAuthenticated && isDemoUserEmail(String(data?.claims?.email ?? ""))) {
    const demoCookie = request.cookies.get(DEMO_SESSION_COOKIE)?.value;
    if (!isDemoCookieValueActive(demoCookie)) {
      await supabase.auth.signOut({ scope: "local" });
      const demoUrl = request.nextUrl.clone();
      demoUrl.pathname = "/demo";
      demoUrl.search = "";
      demoUrl.searchParams.set("utgangen", "1");
      const redirectResponse = NextResponse.redirect(demoUrl);
      // Bevara utloggningens Set-Cookie (skrevs till response via setAll ovan).
      for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
      redirectResponse.cookies.delete(DEMO_SESSION_COOKIE);
      redirectResponse.cookies.delete(DEMO_ACTOR_COOKIE);
      return redirectResponse;
    }
  }

  // Utloggad besökare på "/" ser Drivas publika landningssida – som en
  // rewrite så att URL:en förblir "/" och inloggade fortsatt får appens Hem.
  if (!isAuthenticated && pathname === "/") {
    const landingUrl = request.nextUrl.clone();
    landingUrl.pathname = "/valkommen";
    const rewritten = NextResponse.rewrite(landingUrl, { request });
    for (const cookie of response.cookies.getAll()) rewritten.cookies.set(cookie);
    return rewritten;
  }

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
  // Hoppa över statiska filer, bildoptimering och interna Next-dataanrop.
  // Bred matcher på _next/* + RSC har på Vercel gett trasiga navigeringar
  // ("This page couldn't load").
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
