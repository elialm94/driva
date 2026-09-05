/**
 * Samma vy, två ytor. Bokslutet och årsredovisningen visas både på ägarens
 * sidor (/bokforing/...) och på konsultytan (/redovisning/k/<klient>/...), och
 * de delade komponenterna känner bara ägarytans adresser.
 *
 * Här översätts en ägaradress till konsultytans motsvarighet. Konsulten får
 * aldrig en länk in i ägarytan: den layouten kräver eget företag och skulle
 * kasta ut konsulten till portföljen mitt i arbetet.
 */

/** Ägarytans destination → konsultytans flik för samma sak. */
const TAB_BY_OWNER_PATH: [prefix: string, tab: string][] = [
  ["/bokforing/bokslut", "/bokslut"],
  ["/bokforing/moms", "/moms"],
  ["/bokforing/saldobalans", "/rapporter"],
  ["/bokforing/rapporter", "/rapporter"],
  ["/bokforing/verifikationer", "/verifikationer"],
  ["/bokforing/periodstangning", "/periodstangning"],
  ["/bokforing/ingaende-balans", "/ingaende-balans"],
  ["/bokforing", "/verifikationer"],
  ["/ekonomi", "/bank"],
];

/**
 * Konsultytans adress för en av ägarytans. Bokslutets undersidor har samma
 * form på båda ytorna (/bilagor, /arsredovisning/<år>), så suffixet följer med.
 * En adress utan motsvarighet – lön, hemsida, inställningar – blir klientens
 * arbetsvy, för det är närmaste ställe konsulten faktiskt kommer åt.
 */
export function accountantHref(businessId: string, ownerHref: string): string {
  const base = `/redovisning/k/${businessId}`;
  // Frågan (?ar=2025, ?flik=bank) hör till ägarytans sidor och följer inte med.
  const path = ownerHref.split("?")[0];
  for (const [prefix, tab] of TAB_BY_OWNER_PATH) {
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    // Bokslutets undersidor finns på båda ytorna; övriga flikar har inga.
    const suffix = prefix === "/bokforing/bokslut" ? path.slice(prefix.length) : "";
    return `${base}${tab}${suffix}`;
  }
  return base;
}
