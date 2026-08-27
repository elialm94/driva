/**
 * Central navigation config for the Driva app.
 * Pages should use BackLink / withReturnTo instead of hardcoded back hrefs.
 */

export const RETURN_TO_PARAM = "tillbaka";
export const RETURN_LABEL_PARAM = "tillbakaNamn";

export type NavSection =
  | "hem"
  | "kunder"
  | "uppdrag"
  | "pengar"
  | "bokforing"
  | "hemsida"
  | "assistent";

export const NAV_ITEMS: { href: string; section: NavSection; label: string }[] = [
  { href: "/", section: "hem", label: "Hem" },
  { href: "/kunder", section: "kunder", label: "Kunder" },
  { href: "/uppdrag", section: "uppdrag", label: "Uppdrag" },
  { href: "/pengar", section: "pengar", label: "Pengar" },
  { href: "/bokforing", section: "bokforing", label: "Bokföring" },
  { href: "/hemsida", section: "hemsida", label: "Hemsida" },
  { href: "/assistent", section: "assistent", label: "Assistent" },
];

export const PENGAR_TABS = [
  { key: "offerter", href: "/pengar?flik=offerter", label: "Offerter" },
  { key: "fakturor", href: "/pengar?flik=fakturor", label: "Fakturor" },
  { key: "utgifter", href: "/pengar?flik=utgifter", label: "Utgifter & kvitton" },
  { key: "bank", href: "/pengar?flik=bank", label: "Bank" },
] as const;

export type PengarTab = (typeof PENGAR_TABS)[number]["key"];

export interface RouteMeta {
  /** Path pattern, e.g. /pengar/fakturor/:id */
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
}

/**
 * Most specific patterns first. Public customer pages have section: null
 * so the app sidebar is not considered active there.
 */
export const ROUTES: RouteMeta[] = [
  { pattern: "/pengar/fakturor/:id/redigera", section: "pengar", parent: "/pengar/fakturor/:id", label: "Redigera faktura", backLabel: "Faktura", showBack: true },
  { pattern: "/pengar/fakturor/ny", section: "pengar", parent: "/pengar?flik=fakturor", label: "Ny faktura", backLabel: "Fakturor", showBack: true },
  { pattern: "/pengar/fakturor/:id", section: "pengar", parent: "/pengar?flik=fakturor", label: "Faktura", backLabel: "Fakturor", showBack: true },
  { pattern: "/pengar/offerter/:id/redigera", section: "pengar", parent: "/pengar/offerter/:id", label: "Redigera offert", backLabel: "Offert", showBack: true },
  { pattern: "/pengar/offerter/ny", section: "pengar", parent: "/pengar?flik=offerter", label: "Ny offert", backLabel: "Offerter", showBack: true },
  { pattern: "/pengar/offerter/:id", section: "pengar", parent: "/pengar?flik=offerter", label: "Offert", backLabel: "Offerter", showBack: true },
  { pattern: "/pengar", section: "pengar", label: "Pengar" },
  { pattern: "/kunder/:id", section: "kunder", parent: "/kunder", label: "Kund", backLabel: "Kunder", showBack: true },
  { pattern: "/kunder", section: "kunder", label: "Kunder" },
  { pattern: "/uppdrag/:id", section: "uppdrag", parent: "/uppdrag", label: "Uppdrag", backLabel: "Uppdrag", showBack: true },
  { pattern: "/uppdrag", section: "uppdrag", label: "Uppdrag" },
  { pattern: "/jobb/:id", section: "uppdrag", parent: "/uppdrag", label: "Uppdrag", backLabel: "Uppdrag", showBack: true },
  { pattern: "/jobb", section: "uppdrag", label: "Uppdrag" },
  { pattern: "/bokforing/verifikationer", section: "bokforing", parent: "/bokforing", label: "Verifikationer", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/huvudbok", section: "bokforing", parent: "/bokforing", label: "Huvudbok", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/saldobalans", section: "bokforing", parent: "/bokforing", label: "Saldobalans", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/resultat", section: "bokforing", parent: "/bokforing", label: "Resultatrapport", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/balans", section: "bokforing", parent: "/bokforing", label: "Balansrapport", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/moms", section: "bokforing", parent: "/bokforing", label: "Moms", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing/bokslut", section: "bokforing", parent: "/bokforing", label: "Bokslut", backLabel: "Bokföring", showBack: true },
  { pattern: "/bokforing", section: "bokforing", label: "Bokföring" },
  { pattern: "/installningar", section: null, label: "Inställningar" },
  { pattern: "/foretag", section: null, parent: "/installningar", label: "Företagsuppgifter" },
  { pattern: "/hemsida", section: "hemsida", label: "Hemsida" },
  { pattern: "/assistent", section: "assistent", label: "Assistent" },
  { pattern: "/", section: "hem", label: "Hem" },
  { pattern: "/offert/:token/underlag", section: null, parent: "/offert/:token", label: "Signeringsunderlag", backLabel: "Offerten", showBack: true },
  { pattern: "/offert/:token", section: null, label: "Offert" },
  { pattern: "/faktura/:token", section: null, label: "Faktura" },
  { pattern: "/sajt", section: null, label: "Hemsida" },
];

const APP_PATH_PREFIXES = [
  "/kunder",
  "/uppdrag",
  "/jobb",
  "/pengar",
  "/bokforing",
  "/hemsida",
  "/assistent",
  "/installningar",
  "/foretag",
  "/offert",
  "/faktura",
  "/sajt",
] as const;

const SAFE_ID = /^[a-zA-Z0-9._-]{1,80}$/;

export interface MatchedRoute {
  meta: RouteMeta;
  params: Record<string, string>;
  pathname: string;
}

export function matchRoute(pathname: string): MatchedRoute | null {
  const path = normalizePathname(pathname);
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

export function labelForHref(href: string): string {
  const { pathname, searchParams } = splitHref(href);
  if (pathname === "/pengar") {
    const flik = searchParams.get("flik");
    const tab = PENGAR_TABS.find((t) => t.key === flik);
    if (tab) return tab.label;
    return "Pengar";
  }
  const matched = matchRoute(pathname);
  if (!matched) return "Tillbaka";
  if (matched.meta.pattern === "/uppdrag/:id" || matched.meta.pattern === "/jobb/:id") return "Uppdrag";
  if (matched.meta.pattern === "/kunder/:id") return "Kunder";
  if (matched.meta.pattern === "/pengar/fakturor/:id") return "Faktura";
  if (matched.meta.pattern === "/pengar/offerter/:id") return "Offert";
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
  const current = normalizePathname(pathname);
  if (fromParam && splitHref(fromParam).pathname !== current) {
    return { href: fromParam, label: labelParam ?? labelForHref(fromParam) };
  }

  if (current === "/pengar/offerter/ny" || current === "/pengar/fakturor/ny") {
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
      return { href: `/pengar/fakturor/${invoiceId}`, label: labelParam ?? "Faktura" };
    }
  }

  if (fallback) return fallback;
  return defaultBack(current);
}

export type ReturnNav = { returnTo?: string | null; returnLabel?: string | null };

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
  const path = `/pengar/offerter/${id}`;
  return from ? withReturnTo(path, from.href, from.label) : path;
}

export function invoiceHref(id: string, from?: { href: string; label?: string }): string {
  const path = `/pengar/fakturor/${id}`;
  return from ? withReturnTo(path, from.href, from.label) : path;
}

export function newQuoteHref(params: {
  kund?: string;
  job?: string;
  forfragan?: string;
  tillaggFran?: string;
  from?: { href: string; label?: string };
}): string {
  const search = new URLSearchParams();
  if (params.kund) search.set("kund", params.kund);
  if (params.job) search.set("job", params.job);
  if (params.forfragan) search.set("forfragan", params.forfragan);
  if (params.tillaggFran) search.set("tillaggFran", params.tillaggFran);
  const qs = search.toString();
  const path = qs ? `/pengar/offerter/ny?${qs}` : "/pengar/offerter/ny";
  return params.from ? withReturnTo(path, params.from.href, params.from.label) : path;
}

export function newInvoiceHref(params?: { kund?: string; from?: { href: string; label?: string } }): string {
  const path = params?.kund ? `/pengar/fakturor/ny?kund=${encodeURIComponent(params.kund)}` : "/pengar/fakturor/ny";
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
  const path = rewriteJobPath(normalizePathname(pathname));
  if (!isInternalAppPath(path)) return null;

  const allowed = new URLSearchParams();
  for (const [key, val] of searchParams.entries()) {
    if (key === RETURN_TO_PARAM || key === RETURN_LABEL_PARAM) continue;
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key)) continue;
    if (val.length > 120 || /[<>]/.test(val)) continue;
    allowed.set(key, val);
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

function isInternalAppPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return APP_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function rewriteJobPath(pathname: string): string {
  if (pathname === "/jobb") return "/uppdrag";
  if (pathname.startsWith("/jobb/")) return `/uppdrag/${pathname.slice("/jobb/".length)}`;
  return pathname;
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

function splitHref(href: string): { pathname: string; searchParams: URLSearchParams } {
  const q = href.indexOf("?");
  if (q < 0) return { pathname: normalizePathname(href), searchParams: new URLSearchParams() };
  return {
    pathname: normalizePathname(href.slice(0, q)),
    searchParams: new URLSearchParams(href.slice(q + 1)),
  };
}

function parseHref(href: string): URL {
  return new URL(href, "https://driva.local");
}

function formatHref(url: URL): string {
  return `${url.pathname}${url.search}`;
}
