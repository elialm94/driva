/**
 * Central navigation config for the Driva app.
 *
 * Back = origin ("← Hem"). Breadcrumbs = structure ("Kunder / Uppdrag / …").
 * Origin lives on the navigation event (`tillbaka` query + optional label), never on
 * the domain object. AppLink / resolveAppHref stamp origin; SmartBack reads it.
 * Canonical parent in ROUTES is the fallback when origin is missing or invalid.
 */

export const RETURN_TO_PARAM = "tillbaka";
export const RETURN_LABEL_PARAM = "tillbakaNamn";

export type NavSection = "hem" | "kunder" | "ekonomi" | "inbox" | "bokforing" | "hemsida" | "samarbeta";

/**
 * Primär sidomeny. Badge (tal) betyder "något väntar på dig" – bara Inbox
 * och Bokföring. Hem är den samlade vyn och får ingen summerad badge.
 * Kunder/Ekonomi/Samarbeta/Hemsida räknar inte poster.
 */
export const NAV_ITEMS: { href: string; section: NavSection; label: string }[] = [
  { href: "/", section: "hem", label: "Hem" },
  { href: "/kunder", section: "kunder", label: "Kunder" },
  { href: "/ekonomi", section: "ekonomi", label: "Ekonomi" },
  { href: "/inbox", section: "inbox", label: "Inbox" },
  { href: "/bokforing", section: "bokforing", label: "Bokföring" },
  { href: "/samarbeta", section: "samarbeta", label: "Samarbeta" },
  { href: "/hemsida", section: "hemsida", label: "Hemsida" },
];

/** Hemsida och Samarbeta syns bara när funktionen är aktiv. */
export function visibleNavItems(features: { website: boolean; collaboration: boolean }) {
  return NAV_ITEMS.filter((item) => {
    if (item.section === "hemsida") return features.website;
    if (item.section === "samarbeta") return features.collaboration;
    return true;
  });
}

export const KUNDER_TABS = [
  { key: "kunder", href: "/kunder?flik=kunder", label: "Kunder" },
  { key: "uppdrag", href: "/kunder?flik=uppdrag", label: "Uppdrag" },
] as const;

export type KunderTab = (typeof KUNDER_TABS)[number]["key"];

export const EKONOMI_TABS = [
  { key: "offerter", href: "/ekonomi?flik=offerter", label: "Offerter" },
  { key: "fakturor", href: "/ekonomi?flik=fakturor", label: "Fakturor" },
  { key: "utgifter", href: "/ekonomi?flik=utgifter", label: "Utgifter & kvitton" },
  { key: "bank", href: "/ekonomi?flik=bank", label: "Bank" },
] as const;

export type EkonomiTab = (typeof EKONOMI_TABS)[number]["key"];

/** Bokföringsytan – samma flikar i den delade layouten, egna URL:er. */
export const BOKFORING_DETAIL_TABS = [
  { key: "oversikt", href: "/bokforing", label: "Översikt" },
  { key: "verifikationer", href: "/bokforing/verifikationer", label: "Verifikationer" },
  { key: "huvudbok", href: "/bokforing/huvudbok", label: "Huvudbok" },
  { key: "rapporter", href: "/bokforing/resultat", label: "Rapporter" },
  { key: "moms", href: "/bokforing/moms", label: "Moms" },
  { key: "bokslut", href: "/bokforing/bokslut", label: "Bokslut" },
] as const;

export const BOKFORING_REPORT_TABS = [
  { key: "saldobalans", href: "/bokforing/saldobalans", label: "Saldobalans" },
  { key: "resultat", href: "/bokforing/resultat", label: "Resultat" },
  { key: "balans", href: "/bokforing/balans", label: "Balans" },
] as const;

export const BOKFORING_FLIK_HREF: Record<string, string> = {
  oversikt: "/bokforing",
  verifikationer: "/bokforing/verifikationer",
  huvudbok: "/bokforing/huvudbok",
  rapporter: "/bokforing/resultat",
  moms: "/bokforing/moms",
  bokslut: "/bokforing/bokslut",
  saldobalans: "/bokforing/saldobalans",
  resultat: "/bokforing/resultat",
  balans: "/bokforing/balans",
};

const BOKFORING_REPORT_PATHS = BOKFORING_REPORT_TABS.map((t) => t.href);

/** Alla bokföringsvyer som ska prefetchas när ytan är öppen. */
export const BOKFORING_PREFETCH_HREFS: readonly string[] = Array.from(
  new Set([
    ...BOKFORING_DETAIL_TABS.map((t) => t.href),
    ...BOKFORING_REPORT_TABS.map((t) => t.href),
  ])
);

export function bokforingDetailTabForPath(pathname: string): (typeof BOKFORING_DETAIL_TABS)[number]["key"] | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (path === "/bokforing") return "oversikt";
  if (path === "/bokforing/verifikationer") return "verifikationer";
  if (path === "/bokforing/huvudbok") return "huvudbok";
  if ((BOKFORING_REPORT_PATHS as readonly string[]).includes(path)) return "rapporter";
  if (path === "/bokforing/moms") return "moms";
  if (path === "/bokforing/bokslut") return "bokslut";
  if (path === "/bokforing/detaljer") return "verifikationer";
  return null;
}

export interface RouteMeta {
  /** Path pattern, e.g. /ekonomi/fakturor/:id */
  pattern: string;
  section: NavSection | null;
  /** Fallback parent href. `:param` tokens are filled from the current path. */
  parent?: string;
  /** Short name for this page type. */
  label: string;
  /** Default in-app back label (destination), never generic "Tillbaka". */
  backLabel?: string;
  /** Show in-app back control. */
  showBack?: boolean;
  /**
   * AppLink stamps `tillbaka` even when there is no default back
   * (Inställningar opened from a document checklist).
   */
  acceptsReturnTo?: boolean;
}

/**
 * Most specific patterns first. Public customer pages have section: null
 * so the app sidebar is not considered active there.
 */
export const ROUTES: RouteMeta[] = [
  { pattern: "/ekonomi/fakturor/:id/redigera", section: "ekonomi", parent: "/ekonomi/fakturor/:id", label: "Redigera faktura", backLabel: "Faktura", showBack: true },
  { pattern: "/ekonomi/fakturor/ny", section: "ekonomi", parent: "/ekonomi?flik=fakturor", label: "Ny faktura", backLabel: "Fakturor", showBack: true },
  { pattern: "/ekonomi/fakturor/:id", section: "ekonomi", parent: "/ekonomi?flik=fakturor", label: "Faktura", backLabel: "Fakturor", showBack: true },
  { pattern: "/ekonomi/offerter/:id/redigera", section: "ekonomi", parent: "/ekonomi/offerter/:id", label: "Redigera offert", backLabel: "Offert", showBack: true },
  { pattern: "/ekonomi/offerter/ny", section: "ekonomi", parent: "/ekonomi?flik=offerter", label: "Ny offert", backLabel: "Offerter", showBack: true },
  { pattern: "/ekonomi/offerter/:id", section: "ekonomi", parent: "/ekonomi?flik=offerter", label: "Offert", backLabel: "Offerter", showBack: true },
  { pattern: "/ekonomi", section: "ekonomi", label: "Ekonomi" },
  { pattern: "/inbox/:id/kontrollera", section: "inbox", parent: "/inbox/:id", label: "Kontrollera belopp", backLabel: "Inkorgspost", showBack: true },
  { pattern: "/inbox/:id", section: "inbox", parent: "/inbox", label: "Inkorgspost", backLabel: "Inbox", showBack: true },
  { pattern: "/inbox", section: "inbox", label: "Inbox" },
  { pattern: "/kunder/forfragningar/:id", section: "kunder", parent: "/kunder?flik=uppdrag", label: "Uppdrag", backLabel: "Uppdrag", showBack: true },
  { pattern: "/kunder/:id", section: "kunder", parent: "/kunder?flik=kunder", label: "Kund", backLabel: "Kunder", showBack: true },
  { pattern: "/kunder", section: "kunder", label: "Kunder" },
  { pattern: "/uppdrag/:id", section: "kunder", parent: "/kunder?flik=uppdrag", label: "Uppdrag", backLabel: "Uppdrag", showBack: true },
  { pattern: "/jobb/:id", section: "kunder", parent: "/kunder?flik=uppdrag", label: "Uppdrag", backLabel: "Uppdrag", showBack: true },
  { pattern: "/bokforing/verifikationer", section: "bokforing", parent: "/bokforing", label: "Verifikationer", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/huvudbok", section: "bokforing", parent: "/bokforing", label: "Huvudbok", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/saldobalans", section: "bokforing", parent: "/bokforing", label: "Saldobalans", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/resultat", section: "bokforing", parent: "/bokforing", label: "Resultatrapport", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/balans", section: "bokforing", parent: "/bokforing", label: "Balansrapport", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/moms", section: "bokforing", parent: "/bokforing", label: "Moms", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/bokslut", section: "bokforing", parent: "/bokforing", label: "Bokslut", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/detaljer", section: "bokforing", parent: "/bokforing", label: "Bokföringsdetaljer", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing", section: "bokforing", label: "Bokföring" },
  { pattern: "/samarbeta", section: "samarbeta", label: "Samarbeta" },
  { pattern: "/redovisning/k/:businessId/verifikationer", section: null, parent: "/redovisning/k/:businessId", label: "Verifikationer", backLabel: "Arbeta", showBack: true },
  { pattern: "/redovisning/k/:businessId/bank", section: null, parent: "/redovisning/k/:businessId", label: "Bank", backLabel: "Arbeta", showBack: true },
  { pattern: "/redovisning/k/:businessId/moms", section: null, parent: "/redovisning/k/:businessId", label: "Moms", backLabel: "Arbeta", showBack: true },
  { pattern: "/redovisning/k/:businessId/rapporter", section: null, parent: "/redovisning/k/:businessId", label: "Rapporter", backLabel: "Arbeta", showBack: true },
  { pattern: "/redovisning/k/:businessId/bokslut", section: null, parent: "/redovisning/k/:businessId", label: "Bokslut", backLabel: "Arbeta", showBack: true },
  { pattern: "/redovisning/k/:businessId", section: null, parent: "/redovisning", label: "Arbeta", backLabel: "Arbeta", showBack: true },
  { pattern: "/redovisning/att-gora", section: null, parent: "/redovisning", label: "Arbeta" },
  { pattern: "/redovisning/klienter", section: null, parent: "/redovisning", label: "Klienter" },
  { pattern: "/redovisning", section: null, label: "Redovisning" },
  { pattern: "/inbjudan/:token", section: null, label: "Inbjudan" },
  { pattern: "/installningar", section: null, label: "Inställningar", acceptsReturnTo: true },
  { pattern: "/foretag", section: null, parent: "/installningar", label: "Företagsuppgifter", acceptsReturnTo: true },
  { pattern: "/hemsida/doman", section: "hemsida", parent: "/hemsida", label: "Domän", backLabel: "Hemsida", showBack: true },
  { pattern: "/hemsida", section: "hemsida", label: "Hemsida" },
  { pattern: "/", section: "hem", label: "Hem" },
  { pattern: "/offert/:token/underlag/pdf", section: null, parent: "/offert/:token/underlag", label: "Intyg om godkännande", backLabel: "Intyget", showBack: true },
  { pattern: "/offert/:token/underlag", section: null, parent: "/offert/:token", label: "Intyg om godkännande av offert", backLabel: "Offerten", showBack: true },
  { pattern: "/offert/:token/pdf", section: null, parent: "/offert/:token", label: "Offert – utskrift", backLabel: "Offerten", showBack: true },
  { pattern: "/offert/:token", section: null, label: "Offert" },
  { pattern: "/faktura/:token", section: null, label: "Faktura" },
  { pattern: "/sajt", section: null, label: "Hemsida" },
  { pattern: "/integritetspolicy", section: null, label: "Integritetspolicy" },
];

const APP_PATH_PREFIXES = [
  "/kunder",
  "/uppdrag",
  "/jobb",
  "/ekonomi",
  "/pengar",
  "/bokforing",
  "/hemsida",
  "/inbox",
  "/samarbeta",
  "/redovisning",
  "/inbjudan",
  "/assistent",
  "/installningar",
  "/foretag",
  "/offert",
  "/faktura",
  "/sajt",
  "/integritetspolicy",
] as const;

const SAFE_ID = /^[a-zA-Z0-9._-]{1,80}$/;

export interface MatchedRoute {
  meta: RouteMeta;
  params: Record<string, string>;
  pathname: string;
}

export function matchRoute(pathname: string): MatchedRoute | null {
  const path = rewriteAppPath(normalizePathname(pathname));
  for (const meta of ROUTES) {
    const params = matchPattern(meta.pattern, path);
    if (params) return { meta, params, pathname: path };
  }
  return null;
}

export function sectionForPath(pathname: string): NavSection | null {
  return matchRoute(pathname)?.meta.section ?? null;
}

export function isSectionActive(pathname: string, href: string): boolean {
  if (href === "/") return normalizePathname(pathname) === "/";
  const section = NAV_ITEMS.find((item) => item.href === href)?.section;
  if (!section) return normalizePathname(pathname).startsWith(href);
  return sectionForPath(pathname) === section;
}

/** Sidofotens Inställningar – ingen egen NavSection. */
export function isSettingsPath(pathname: string): boolean {
  const path = splitHref(pathname).pathname;
  return path === "/installningar" || path.startsWith("/installningar/") || path === "/foretag" || path.startsWith("/foretag/");
}

/** Sidofotens Hjälp & support – ingen egen NavSection. */
export function isSupportPath(pathname: string): boolean {
  const path = splitHref(pathname).pathname;
  return path === "/support" || path.startsWith("/support/");
}

export function labelForHref(href: string): string {
  const rewritten = rewriteLegacyHref(href);
  const { pathname, searchParams } = splitHref(rewritten);
  if (pathname === "/ekonomi") {
    const flik = searchParams.get("flik");
    const tab = EKONOMI_TABS.find((t) => t.key === flik);
    if (tab) return tab.label;
    return "Ekonomi";
  }
  if (pathname === "/kunder") {
    const flik = searchParams.get("flik");
    const tab = KUNDER_TABS.find((t) => t.key === flik);
    if (tab) return tab.label;
    return "Kunder";
  }
  if (pathname === "/inbox") return "Inbox";
  const matched = matchRoute(pathname);
  if (!matched) return "Tillbaka";
  return matched.meta.label;
}

export function parentHref(pathname: string): string | null {
  const matched = matchRoute(pathname);
  if (!matched?.meta.parent) return null;
  return fillPattern(matched.meta.parent, matched.params);
}

export function defaultBack(pathname: string): { href: string; label: string } | null {
  const matched = matchRoute(pathname);
  if (!matched?.meta.showBack || !matched.meta.parent) return null;
  return {
    href: fillPattern(matched.meta.parent, matched.params),
    label: matched.meta.backLabel ?? "Tillbaka",
  };
}

/** Pathname+query for the current view, used as origin when leaving. */
export function locationHref(pathname: string, search?: { toString(): string } | string | null): string {
  const qs = !search ? "" : typeof search === "string" ? search.replace(/^\?/, "") : search.toString();
  return rewriteLegacyHref(qs ? `${normalizePathname(pathname)}?${qs}` : pathname);
}

export function isBackAwarePath(pathname: string): boolean {
  const matched = matchRoute(pathname);
  return matched?.meta.showBack === true || matched?.meta.acceptsReturnTo === true;
}

/**
 * If `destPathname` already appears in the origin's tillbaka-chain, return that
 * node (including nested tillbaka). Prevents A→B→A loops when cross-linking.
 */
export function originNodeMatching(originHref: string, destPathname: string): string | null {
  const dest = rewriteAppPath(splitHref(destPathname).pathname);
  let cursor: string | null = sanitizeReturnTo(originHref);
  for (let i = 0; i < 8 && cursor; i++) {
    const { pathname, searchParams } = splitHref(cursor);
    if (rewritePengarPath(pathname) === dest) return cursor;
    cursor = sanitizeReturnTo(searchParams.get(RETURN_TO_PARAM));
  }
  return null;
}

export function shouldStampOrigin(originHref: string, destHref: string): boolean {
  const trimmed = destHref.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false;
  const destParts = splitHref(trimmed);
  const destPath = rewriteAppPath(destParts.pathname);
  if (!isInternalAppPath(destPath) || !isBackAwarePath(destPath)) return false;
  if (destParts.searchParams.has(RETURN_TO_PARAM)) return false;
  if (originNodeMatching(originHref, destPath)) return false;
  const origin = sanitizeReturnTo(originHref);
  if (!origin) return false;
  if (splitHref(origin).pathname === destPath) return false;
  return true;
}

/**
 * Stamp origin onto an internal detail href, or reuse a chain node to avoid loops.
 * Destinations that already have `tillbaka`, list pages, and invalid origins are left as-is.
 */
export function resolveAppHref(destHref: string, originHref: string, originLabel?: string | null): string {
  const trimmed = destHref.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return destHref;
  const rewritten = rewriteLegacyHref(trimmed);
  const destParts = splitHref(rewritten);
  const destPath = destParts.pathname;
  if (!isInternalAppPath(destPath)) return destHref;
  if (destParts.searchParams.has(RETURN_TO_PARAM)) return rewritten;

  const chained = originNodeMatching(originHref, destPath);
  if (chained) return chained;

  if (!shouldStampOrigin(originHref, rewritten)) return rewritten;
  return withReturnTo(rewritten, originHref, originLabel ?? labelForHref(originHref));
}

/** sessionStorage key for scroll of a view. Strips origin params so the list state is the key. */
export function scrollKeyForHref(href: string): string {
  const { pathname, searchParams } = splitHref(href);
  searchParams.delete(RETURN_TO_PARAM);
  searchParams.delete(RETURN_LABEL_PARAM);
  const qs = searchParams.toString();
  return `driva:scroll:${rewriteLegacyHref(qs ? `${pathname}?${qs}` : pathname)}`;
}

/** Structural crumbs — hierarchy, never navigation history. */
export function structuralCrumbs(
  pathname: string,
  currentLabel?: string
): { href?: string; label: string }[] {
  const matched = matchRoute(pathname);
  if (!matched) return [];
  const title = currentLabel ?? matched.meta.label;
  switch (matched.meta.pattern) {
    case "/inbox/:id":
      return [{ href: "/inbox", label: "Inbox" }, { label: title }];
    case "/kunder/forfragningar/:id":
      return [
        { href: "/kunder?flik=kunder", label: "Kunder" },
        { href: "/kunder?flik=uppdrag", label: "Uppdrag" },
        { label: title },
      ];
    case "/kunder/:id":
      return [{ href: "/kunder?flik=kunder", label: "Kunder" }, { label: title }];
    case "/uppdrag/:id":
    case "/jobb/:id":
      return [
        { href: "/kunder?flik=kunder", label: "Kunder" },
        { href: "/kunder?flik=uppdrag", label: "Uppdrag" },
        { label: title },
      ];
    case "/ekonomi/fakturor/ny":
    case "/ekonomi/fakturor/:id":
    case "/ekonomi/fakturor/:id/redigera":
      return [
        { href: "/ekonomi", label: "Ekonomi" },
        { href: "/ekonomi?flik=fakturor", label: "Fakturor" },
        { label: title },
      ];
    case "/ekonomi/offerter/ny":
    case "/ekonomi/offerter/:id":
    case "/ekonomi/offerter/:id/redigera":
      return [
        { href: "/ekonomi", label: "Ekonomi" },
        { href: "/ekonomi?flik=offerter", label: "Offerter" },
        { label: title },
      ];
    case "/hemsida/doman":
      return [{ href: "/hemsida", label: "Hemsida" }, { label: title }];
    case "/bokforing/verifikationer":
    case "/bokforing/huvudbok":
    case "/bokforing/saldobalans":
    case "/bokforing/resultat":
    case "/bokforing/balans":
    case "/bokforing/moms":
    case "/bokforing/bokslut":
    case "/bokforing/detaljer":
      return [{ href: "/bokforing", label: "Bokföring" }, { label: title }];
    default:
      if (matched.meta.showBack && matched.meta.parent) {
        return [
          { href: fillPattern(matched.meta.parent, matched.params), label: matched.meta.backLabel ?? matched.meta.label },
          { label: title },
        ];
      }
      return [];
  }
}

/**
 * In-app back: explicit returnTo, then create-flow query context, then route parent.
 * Browser back remains real history and is not overridden here.
 */
export function resolveBack(
  pathname: string,
  search: { get(name: string): string | null },
  fallback?: { href: string; label: string }
): { href: string; label: string } | null {
  const fromParam = sanitizeReturnTo(search.get(RETURN_TO_PARAM));
  const labelParam = sanitizeReturnLabel(search.get(RETURN_LABEL_PARAM));
  const current = rewriteAppPath(pathname);
  if (fromParam && rewriteAppPath(splitHref(fromParam).pathname) !== current) {
    return { href: fromParam, label: labelParam ?? labelForHref(fromParam) };
  }

  if (current === "/ekonomi/offerter/ny" || current === "/ekonomi/fakturor/ny") {
    const jobId = sanitizeId(search.get("job") ?? search.get("uppdrag"));
    if (jobId) {
      const href = `/uppdrag/${jobId}`;
      const label =
        labelParam ??
        (fallback && splitHref(fallback.href).pathname === href ? fallback.label : "Uppdrag");
      return { href, label };
    }
    const invoiceId = sanitizeId(search.get("tillaggFran"));
    if (invoiceId) {
      return { href: `/ekonomi/fakturor/${invoiceId}`, label: labelParam ?? "Faktura" };
    }
  }

  if (fallback) return fallback;
  return defaultBack(current);
}

export type ReturnNav = { returnTo?: string | null; returnLabel?: string | null };

export type PageOrigin = { href: string; label: string };

function firstSearchValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/** `tillbaka` / `tillbakaNamn` from a page search object or URLSearchParams. */
export function returnNavFromSearch(
  search:
    | { get(name: string): string | null }
    | { tillbaka?: string | string[]; tillbakaNamn?: string | string[] }
): ReturnNav {
  const reader = search as { get?: (name: string) => string | null };
  const tillbaka =
    typeof reader.get === "function"
      ? reader.get(RETURN_TO_PARAM)
      : firstSearchValue((search as { tillbaka?: string | string[] }).tillbaka);
  const tillbakaNamn =
    typeof reader.get === "function"
      ? reader.get(RETURN_LABEL_PARAM)
      : firstSearchValue((search as { tillbakaNamn?: string | string[] }).tillbakaNamn);
  return {
    returnTo: sanitizeReturnTo(tillbaka),
    returnLabel: sanitizeReturnLabel(tillbakaNamn),
  };
}

/** Current page as origin, including any incoming tillbaka-chain. */
export function pageOrigin(
  pathname: string,
  search: Parameters<typeof returnNavFromSearch>[0],
  label: string
): PageOrigin {
  return { href: hrefWithNav(pathname, returnNavFromSearch(search)), label };
}

/** Stamp a destination so Back returns to `origin` (the page you left). */
export function hrefFromOrigin(dest: string, origin: PageOrigin | null | undefined): string {
  if (!origin) return dest;
  return withReturnTo(dest, origin.href, origin.label);
}

export function hrefWithNav(path: string, nav?: ReturnNav | null): string {
  if (!nav) return path;
  return withReturnTo(path, nav.returnTo, nav.returnLabel);
}

/** Append a sanitized internal return path. Never used for open redirects. */
export function withReturnTo(href: string, returnTo?: string | null, label?: string | null): string {
  const safe = sanitizeReturnTo(returnTo);
  if (!safe) return href;
  const url = parseHref(href);
  url.searchParams.set(RETURN_TO_PARAM, safe);
  const name = sanitizeReturnLabel(label);
  if (name) url.searchParams.set(RETURN_LABEL_PARAM, name);
  else url.searchParams.delete(RETURN_LABEL_PARAM);
  return formatHref(url);
}

export function preserveReturnTo(href: string, search: { get(name: string): string | null }): string {
  return withReturnTo(href, search.get(RETURN_TO_PARAM), search.get(RETURN_LABEL_PARAM));
}

export function quoteHref(id: string, from?: { href: string; label?: string }): string {
  const path = `/ekonomi/offerter/${id}`;
  return from ? withReturnTo(path, from.href, from.label) : path;
}

export function invoiceHref(id: string, from?: { href: string; label?: string }): string {
  const path = `/ekonomi/fakturor/${id}`;
  return from ? withReturnTo(path, from.href, from.label) : path;
}

export function invoiceEditHref(id: string, from?: { href: string; label?: string }): string {
  const path = `/ekonomi/fakturor/${id}/redigera`;
  return from ? withReturnTo(path, from.href, from.label) : path;
}

export function customerHref(id: string, from?: { href: string; label?: string }): string {
  const path = `/kunder/${id}`;
  return from ? withReturnTo(path, from.href, from.label) : path;
}

export function jobHref(id: string, from?: { href: string; label?: string }): string {
  const path = `/uppdrag/${id}`;
  return from ? withReturnTo(path, from.href, from.label) : path;
}

export function kunderInboxHref(): string {
  return "/inbox";
}

export function newQuoteHref(params: {
  kund?: string;
  job?: string;
  tillaggFran?: string;
  from?: { href: string; label?: string };
}): string {
  const search = new URLSearchParams();
  if (params.kund) search.set("kund", params.kund);
  if (params.job) search.set("job", params.job);
  if (params.tillaggFran) search.set("tillaggFran", params.tillaggFran);
  const qs = search.toString();
  const path = qs ? `/ekonomi/offerter/ny?${qs}` : "/ekonomi/offerter/ny";
  return params.from ? withReturnTo(path, params.from.href, params.from.label) : path;
}

export function newInvoiceHref(params?: {
  kund?: string;
  job?: string;
  fristaende?: boolean;
  from?: { href: string; label?: string };
}): string {
  const search = new URLSearchParams();
  if (params?.kund) search.set("kund", params.kund);
  if (params?.job) search.set("job", params.job);
  if (params?.fristaende) search.set("fristaende", "1");
  const qs = search.toString();
  const path = qs ? `/ekonomi/fakturor/ny?${qs}` : "/ekonomi/fakturor/ny";
  return params?.from ? withReturnTo(path, params.from.href, params.from.label) : path;
}

export function sanitizeReturnTo(raw: string | null | undefined, depth = 0): string | null {
  if (!raw || depth > 3) return null;
  let value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;
  if (value.includes("\\") || value.includes("@") || /[\u0000-\u001F]/.test(value)) return null;
  if (value.length > 500) return null;

  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }

  value = value.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;
  if (value.includes("\\") || value.includes("@")) return null;

  const hashIndex = value.indexOf("#");
  if (hashIndex >= 0) value = value.slice(0, hashIndex);

  const { pathname, searchParams } = splitHref(value);
  const sourcePath = rewritePengarPath(rewriteJobPath(normalizePathname(pathname)));
  let path = rewriteInquiryPath(rewriteAssistentPath(rewriteUppdragListPath(sourcePath)));
  if (sourcePath === "/kunder" && searchParams.get("flik") === "forfragningar") {
    path = "/kunder";
    searchParams.set("flik", "uppdrag");
  }
  if (!isInternalAppPath(path)) return null;

  const allowed = new URLSearchParams();
  for (const [key, val] of searchParams.entries()) {
    if (key === RETURN_TO_PARAM || key === RETURN_LABEL_PARAM) continue;
    if (key === "flik" && val === "forfragningar") continue;
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key)) continue;
    if (val.length > 120 || /[<>]/.test(val)) continue;
    allowed.set(key, val);
  }
  if (sourcePath === "/uppdrag" && path === "/kunder" && !allowed.has("flik")) {
    allowed.set("flik", "uppdrag");
  }
  const nestedReturn = sanitizeReturnTo(searchParams.get(RETURN_TO_PARAM), depth + 1);
  if (nestedReturn) allowed.set(RETURN_TO_PARAM, nestedReturn);
  const nestedLabel = sanitizeReturnLabel(searchParams.get(RETURN_LABEL_PARAM));
  if (nestedLabel) allowed.set(RETURN_LABEL_PARAM, nestedLabel);
  const qs = allowed.toString();
  return qs ? `${path}?${qs}` : path;
}

export function sanitizeReturnLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\u0000-\u001F<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || null;
}

export function sanitizeId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  return SAFE_ID.test(value) ? value : null;
}

export function isInternalAppPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return APP_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function rewriteJobPath(pathname: string): string {
  if (pathname === "/jobb") return "/uppdrag";
  if (pathname.startsWith("/jobb/")) return `/uppdrag/${pathname.slice("/jobb/".length)}`;
  return pathname;
}

/** Uppdragslistan flyttade under Kunder. Detalj `/uppdrag/:id` lämnas orörd. */
export function rewriteUppdragListPath(pathname: string): string {
  if (pathname === "/uppdrag") return "/kunder";
  return pathname;
}

function rewriteAssistentPath(pathname: string): string {
  if (pathname === "/assistent") return "/";
  return pathname;
}

function rewriteInquiryPath(pathname: string): string {
  if (pathname.startsWith("/kunder/forfragningar/")) {
    return `/uppdrag/${pathname.slice("/kunder/forfragningar/".length)}`;
  }
  return pathname;
}

function rewritePengarPath(pathname: string): string {
  if (pathname === "/pengar") return "/ekonomi";
  if (pathname.startsWith("/pengar/")) return `/ekonomi/${pathname.slice("/pengar/".length)}`;
  return pathname;
}

function rewriteAppPath(pathname: string): string {
  return rewriteInquiryPath(
    rewriteAssistentPath(rewriteUppdragListPath(rewritePengarPath(rewriteJobPath(normalizePathname(pathname)))))
  );
}

/** Path + query för gamla bokmärken och `tillbaka=`-kedjor. */
export function rewriteLegacyHref(href: string): string {
  const { pathname, searchParams, hash } = splitHref(href);
  const sourcePath = rewritePengarPath(rewriteJobPath(normalizePathname(pathname)));
  let path = rewriteInquiryPath(rewriteAssistentPath(rewriteUppdragListPath(sourcePath)));
  const params = new URLSearchParams(searchParams);
  if (sourcePath === "/kunder" && params.get("flik") === "forfragningar") {
    path = "/kunder";
    params.set("flik", "uppdrag");
  }
  if (sourcePath === "/uppdrag" && path === "/kunder" && !params.has("flik")) {
    params.set("flik", "uppdrag");
  }
  const qs = params.toString();
  return `${qs ? `${path}?${qs}` : path}${hash}`;
}

function normalizePathname(pathname: string): string {
  if (!pathname) return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (pattern === "/" && pathname === "/") return {};
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    const value = pathParts[i];
    if (part.startsWith(":")) {
      params[part.slice(1)] = value;
      continue;
    }
    if (part !== value) return null;
  }
  return params;
}

function fillPattern(pattern: string, params: Record<string, string>): string {
  const [path, query] = pattern.split("?");
  const filled = path.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => params[key] ?? `:${key}`);
  return query ? `${filled}?${query}` : filled;
}

function splitHref(href: string): { pathname: string; searchParams: URLSearchParams; hash: string } {
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const q = withoutHash.indexOf("?");
  if (q < 0) return { pathname: normalizePathname(withoutHash), searchParams: new URLSearchParams(), hash };
  return {
    pathname: normalizePathname(withoutHash.slice(0, q)),
    searchParams: new URLSearchParams(withoutHash.slice(q + 1)),
    hash,
  };
}

function parseHref(href: string): URL {
  return new URL(href, "https://driva.local");
}

function formatHref(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}
