/**
 * Samma vy, två ytor. Bokföringens sidor visas både på ägarens yta
 * (/bokforing/...) och på konsultytan (/redovisning/k/<klient>/...), och de
 * delade komponenterna känner bara ägarytans adresser.
 *
 * Här översätts en ägaradress till konsultytans motsvarighet. Konsulten får
 * aldrig en länk in i ägarytan: den layouten kräver eget företag och skulle
 * kasta ut konsulten till portföljen mitt i arbetet.
 */
import { portfolioBasePath, workspaceHref } from "../accounting-workspace/tabs";

/** Ägarytans destinationer utanför bokföringen → närmaste konsultflik. */
const OUTSIDE_WORKSPACE: [prefix: string, tab: string][] = [["/ekonomi", "/bank"]];

/**
 * Konsultytans adress för en av ägarytans. Bokföringens alla sidor har samma
 * form på båda ytorna, så suffix och frågesträng (?ar=2025) följer med.
 * En adress utan motsvarighet – hemsida, inställningar – blir klientens
 * arbetsvy, för det är närmaste ställe konsulten faktiskt kommer åt.
 */
export function accountantHref(businessId: string, ownerHref: string): string {
  const base = portfolioBasePath(businessId);
  const path = ownerHref.split("?")[0] ?? ownerHref;
  for (const [prefix, tab] of OUTSIDE_WORKSPACE) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return `${base}${tab}`;
  }
  return workspaceHref(base, ownerHref);
}
