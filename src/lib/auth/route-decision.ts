/**
 * Proxyns ruttbeslut som REN funktion – proxyn (src/proxy.ts) samlar in
 * sessionsläget och verkställer; själva reglerna bor och testas här:
 *
 *   * Utloggad på "/" → landningssidan (rewrite till /valkommen, URL:en
 *     förblir "/"). Inloggad på "/" → appens Hem, precis som förut.
 *   * Utloggad på skyddad ruta → /login?next=…
 *   * Inloggad på /login|/signup → "/" (ingen dubbelinloggning).
 *   * Demosession vars demo-cookie saknas/gått ut → släpp sessionen och
 *     tillbaka till /demo (som provisionerar en fräsch session).
 */

export const PUBLIC_PREFIXES = [
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
  "/api/demo-cleanup", // cron-städning av utgångna demosessioner (CRON_SECRET-vaktad)
  "/admin/inbjudan", // admin-invitationens acceptsida: mottagaren saknar ofta konto ännu
  "/api/bankid",
  "/api/inbox",
  "/api/dev", // vaktas internt: endast utveckling
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type RouteDecision =
  | { kind: "next" }
  | { kind: "rewrite"; pathname: string }
  | { kind: "redirect"; pathname: string; next?: string }
  /** Demosessionens cookie saknas/utgången: släpp sessionen → /demo. */
  | { kind: "end_demo_session"; pathname: string };

export function decideRoute(input: {
  pathname: string;
  search: string;
  isAuthenticated: boolean;
  /** Inloggad som den delade demo-användaren? */
  isDemoUser: boolean;
  /** Finns en olöpt demo-cookie? (Proxyn läser utgångstiden ur värdet.) */
  demoCookieActive: boolean;
}): RouteDecision {
  const { pathname, search, isAuthenticated, isDemoUser, demoCookieActive } = input;

  // Demosessioner är tidsbegränsade: utan giltig demo-cookie släpps
  // demo-användarens session (endast DENNA besökares tokens) och /demo
  // startar en fräsch session. Riktiga användare berörs aldrig.
  if (isAuthenticated && isDemoUser && !demoCookieActive) {
    return { kind: "end_demo_session", pathname: "/demo" };
  }

  // Utloggad besökare på "/" ser Drivas publika landningssida – som rewrite
  // så att URL:en förblir "/" och inloggade fortsatt får appens Hem.
  if (!isAuthenticated && pathname === "/") {
    return { kind: "rewrite", pathname: "/valkommen" };
  }

  if (!isAuthenticated && !isPublicPath(pathname)) {
    const next = `${pathname}${search}`;
    const carryNext = next !== "/" && !next.startsWith("/login") && !next.startsWith("/signup");
    return { kind: "redirect", pathname: "/login", ...(carryNext ? { next } : {}) };
  }

  if (isAuthenticated && (pathname === "/login" || pathname === "/signup")) {
    return { kind: "redirect", pathname: "/" };
  }

  return { kind: "next" };
}
