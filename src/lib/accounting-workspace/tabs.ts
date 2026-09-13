/**
 * Adressöversättning för den gemensamma redovisningsarbetsytan – klientsäker.
 *
 * En ägare i redovisningsvyn och en inbjuden redovisningskonsult ser SAMMA
 * flikrad (BOKFORING_DETAIL_TABS i nav.ts) och samma sidor. Det enda som
 * skiljer är basvägen: ägaren arbetar under /bokforing, konsulten under
 * /redovisning/k/<businessId>. De delade komponenterna känner bara ägarytans
 * adresser; här översätts de åt båda hållen.
 */

export const OWNER_WORKSPACE_BASE = "/bokforing";

export function portfolioBasePath(businessId: string): string {
  return `/redovisning/k/${businessId}`;
}

function splitQuery(href: string): [path: string, query: string | undefined] {
  const i = href.indexOf("?");
  return i === -1 ? [href, undefined] : [href.slice(0, i), href.slice(i + 1)];
}

/** Relativ väg under basvägen, eller null om sökvägen ligger utanför ytan. */
export function workspaceRelativePath(basePath: string, pathname: string): string | null {
  const [path] = splitQuery(pathname);
  if (path === basePath) return "";
  if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length);
  return null;
}

/**
 * Ägaradress → arbetsytans adress. På ägarytan identiteten; på konsultytan
 * blir /bokforing/moms?ar=2025 → /redovisning/k/<id>/moms?ar=2025. Adresser
 * utanför bokföringen (t.ex. /ekonomi) har ingen motsvarighet och blir
 * arbetsytans start, så att konsulten aldrig får en länk in i ägarens layout.
 */
export function workspaceHref(basePath: string, ownerHref: string): string {
  if (basePath === OWNER_WORKSPACE_BASE) return ownerHref;
  const [path, query] = splitQuery(ownerHref);
  const rel = workspaceRelativePath(OWNER_WORKSPACE_BASE, path);
  if (rel == null) return basePath;
  return `${basePath}${rel}${query ? `?${query}` : ""}`;
}

/**
 * Arbetsytans adress → ägaradressen den motsvarar, så att flik- och
 * ruttlogik som är skriven för /bokforing kan återanvändas på konsultytan.
 * Sökvägar utanför arbetsytan returneras oförändrade.
 */
export function ownerPathFor(basePath: string, pathname: string): string {
  if (basePath === OWNER_WORKSPACE_BASE) return pathname;
  const [path, query] = splitQuery(pathname);
  const rel = workspaceRelativePath(basePath, path);
  if (rel == null) return pathname;
  return `${OWNER_WORKSPACE_BASE}${rel}${query ? `?${query}` : ""}`;
}

/**
 * Vilken arbetsyta står vi på? Konsultytans basväg om adressen ligger under
 * /redovisning/k/<id>, annars ägarens. Används av klientkomponenter som
 * navigerar programmatiskt (router.replace) med ägaradresser.
 */
export function workspaceBaseFromPathname(pathname: string): string {
  const m = pathname.match(/^\/redovisning\/k\/([^/?#]+)/);
  return m ? portfolioBasePath(m[1]) : OWNER_WORKSPACE_BASE;
}

/** Är adressen en ägaradress som behöver översättas på en annan yta? */
export function isOwnerWorkspaceHref(href: string): boolean {
  return workspaceRelativePath(OWNER_WORKSPACE_BASE, href) != null;
}
