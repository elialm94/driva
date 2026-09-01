/**
 * Proxy (Next 16-namnet för middleware): sessionsuppfriskning + ruttskydd.
 *
 *   * Friskar upp utgången Supabase-session på varje request (getClaims →
 *     nya cookies skrivs till svaret) så att inloggningen är beständig.
 *   * Utloggad på "/" får den publika landningssidan (rewrite till
 *     /valkommen – URL:en förblir "/"). Inloggade och demosessioner ser
 *     appens Hem som vanligt.
 *   * Oautentiserade requests till appens skyddade rutter skickas till
 *     /login?next=<ursprunglig sökväg> och tillbaka efter inloggning.
 *   * Publika ytor (offert-/fakturalänkar, kundsajt, BankID-API) släpps
 *     igenom orörda – de auktoriseras med ogissbara tokens på serversidan.
 *   * Demosessioner är en httpOnly-cookie (driva_demo) som pekar på
 *     besökarens egen JSON-fil – ingen Supabase-identitet. En giltig
 *     demo-cookie släpps in i appen; en utgången rensas och besökaren
 *     landar på landningssidan igen. En RIKTIG inloggning vinner alltid
 *     över en kvarglömd demokaka.
 *
 * Utan Supabase-miljö (lokal JSON-utveckling) är proxyn passiv.
 * OBS: Detta är första försvarslinjen för UX – den riktiga auktoriseringen
 * sker alltid på serversidan (withBusiness + demofilens request-skopning),
 * aldrig bara här.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  DEMO_ACTOR_COOKIE,
  DEMO_SESSION_COOKIE,
  demoSessionIdFromCookie,
} from "@/lib/auth/demo-session";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/verifiera-epost", // efter registrering: "kolla din mejl"-sidan
  "/glomt-losenord",
  "/auth/bekrafta", // e-postbekräftelse/återställningslänkar från Supabase
  "/demo", // publik demo: GET provisionerar en isolerad demosession
  "/valkommen", // landningssidans interna sökväg (rewrite-mål)
  "/villkor",
  "/integritet", // Drivas egen integritetspolicy (kundsajternas ligger på /integritetspolicy)
  "/offert",
  "/faktura",
  "/sajt",
  "/integritetspolicy",
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

  // Demosessionen: giltig cookie + INGEN riktig inloggning. Cookien pekar på
  // besökarens egen JSON-fil på serversidan – den ger aldrig åtkomst till
  // riktiga data, och en riktig session vinner alltid över en kvarglömd kaka.
  const demoCookie = request.cookies.get(DEMO_SESSION_COOKIE)?.value;
  const hasDemoSession = !isAuthenticated && demoSessionIdFromCookie(demoCookie) !== null;

  // Utgången/trasig demokaka: rensa den och låt besökaren landa som utloggad
  // (landningssidan på "/"). Ny demo startas via "Se demo" – aldrig av sig själv.
  if (!isAuthenticated && demoCookie && !hasDemoSession && pathname !== "/demo") {
    const target = request.nextUrl.clone();
    target.pathname = "/";
    target.search = "";
    const redirectResponse = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
    redirectResponse.cookies.delete(DEMO_SESSION_COOKIE);
    redirectResponse.cookies.delete(DEMO_ACTOR_COOKIE);
    return redirectResponse;
  }

  // Landningssidans interna sökväg har "/" som kanonisk adress.
  if (pathname === "/valkommen") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  // Utloggad (och utan demosession) på "/": visa landningssidan (URL:en förblir "/").
  if (!isAuthenticated && !hasDemoSession && pathname === "/") {
    const landingUrl = request.nextUrl.clone();
    landingUrl.pathname = "/valkommen";
    const rewrite = NextResponse.rewrite(landingUrl, { request });
    for (const cookie of response.cookies.getAll()) rewrite.cookies.set(cookie);
    return rewrite;
  }

  if (!isAuthenticated && !hasDemoSession && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const next = `${pathname}${search}`;
    if (next !== "/" && !next.startsWith("/login") && !next.startsWith("/signup")) {
      loginUrl.searchParams.set("next", next);
    }
    return NextResponse.redirect(loginUrl);
  }

  // Endast RIKTIGA sessioner skickas bort från login/registrering – en
  // demosession ska tvärtom kunna skapa sitt konto därifrån.
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
