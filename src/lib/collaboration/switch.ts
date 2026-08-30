/**
 * Destinationslogik för klientbytet i redovisningsytan.
 * Ren funktion – ingen I/O. Cookie + redirect sköts av server actions.
 */

const CLIENT_SUBPAGES = ["verifikationer", "bank", "moms", "rapporter", "bokslut"] as const;

export type ClientSubpage = (typeof CLIENT_SUBPAGES)[number];

export function parseSelectedClientId(pathname: string): string | null {
  const m = pathname.match(/^\/redovisning\/k\/([^/]+)/);
  return m?.[1] ?? null;
}

export function parseClientSubpage(pathname: string): ClientSubpage | null {
  const m = pathname.match(/^\/redovisning\/k\/[^/]+\/([^/]+)/);
  const sub = m?.[1];
  return sub && (CLIENT_SUBPAGES as readonly string[]).includes(sub) ? (sub as ClientSubpage) : null;
}

export function isArbetaPath(pathname: string): boolean {
  if (pathname === "/redovisning") return true;
  if (pathname === "/redovisning/att-gora" || pathname.startsWith("/redovisning/att-gora")) return true;
  if (pathname === "/redovisning/klienter") return true;
  const client = parseSelectedClientId(pathname);
  return Boolean(client) && !parseClientSubpage(pathname);
}

export function arbetaHref(clientId: string | null): string {
  return clientId ? `/redovisning/k/${clientId}` : "/redovisning";
}

/** Behåller flik när man byter klient; Alla klienter går till portföljkö. */
export function clientSwitchDestination(
  pathname: string,
  nextClientId: string | null
): string {
  const path = pathname.split("?")[0] ?? pathname;

  if (nextClientId) {
    if (path === "/redovisning/att-gora") return `/redovisning/k/${nextClientId}`;
    const sub = parseClientSubpage(path);
    if (sub) return `/redovisning/k/${nextClientId}/${sub}`;
    if (parseSelectedClientId(path) || path === "/redovisning" || path === "/redovisning/klienter") {
      return `/redovisning/k/${nextClientId}`;
    }
    return `/redovisning/k/${nextClientId}`;
  }

  if (path === "/redovisning/att-gora") return "/redovisning";
  return "/redovisning";
}

export function safeAccountantPath(nextPath?: string): string | null {
  if (!nextPath) return null;
  const trimmed = nextPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (!trimmed.startsWith("/redovisning")) return null;
  if (trimmed.length > 500 || /[<>\\]/.test(trimmed)) return null;
  return trimmed;
}
