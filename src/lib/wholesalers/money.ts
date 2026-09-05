/**
 * Pengar i grossistflödet: heltalsören. Tolkning av svenska och engelska
 * talformat ur prisfiler ("1 234,50", "1.234,50", "1234.50", "12,5 %") och
 * formatering tillbaka till svenska kronor. Klientsäker (inga beroenden).
 */

/** Tolka ett tal ur en cell. null = tomt/ogiltigt (aldrig gissning). */
export function parseDecimal(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw)
    .replace(/\u00a0/g, " ")
    .replace(/(kr|sek|:-|%|st|kronor)/gi, "")
    .replace(/\s+/g, "")
    .trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (commas > 0 && dots > 0) {
    // Båda finns: det sista tecknet är decimaltecken, det andra tusental.
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (commas > 1) {
    s = s.replace(/,/g, "");
  } else if (commas === 1) {
    s = s.replace(",", ".");
  } else if (dots > 1) {
    s = s.replace(/\./g, "");
  } else if (dots === 1) {
    // En punkt följd av exakt tre siffror i en svensk fil = tusentalsavgränsare.
    const [, frac] = s.split(".");
    if (frac.length === 3) s = s.replace(".", "");
  }
  if (!/^\d*\.?\d*$/.test(s) || s === "." || s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Kronor (decimal) → heltalsören. null vid ogiltigt/negativt värde. */
export function parseOre(raw: string | undefined | null): number | null {
  const n = parseDecimal(raw);
  if (n == null || n < 0) return null;
  return Math.round(n * 100);
}

/** Procent 0–100 ("12,5", "12,5 %", "0,125" tolkas INTE som andel – filer skriver procent). */
export function parsePercent(raw: string | undefined | null): number | null {
  const n = parseDecimal(raw);
  if (n == null || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

/** Ören → kronor (decimal). */
export function oreToKronor(ore: number): number {
  return ore / 100;
}

/** Kronor → ören, avrundat. */
export function kronorToOre(kr: number): number {
  return Math.round(kr * 100);
}

/** Ören → hela kronor (appens fakturamodell), avrundat till närmaste krona. */
export function oreToWholeKronor(ore: number): number {
  return Math.round(ore / 100);
}

/** Hela kronor → ören (alltid multipel av 100). */
export function wholeKronorToOre(kr: number): number {
  return Math.round(kr) * 100;
}

/** "1 234,50 kr" – svenska format med ören när de finns, annars "1 234 kr". */
export function formatOre(ore: number, opts: { alwaysDecimals?: boolean } = {}): string {
  const kr = ore / 100;
  const hasOre = ore % 100 !== 0;
  const formatted = kr.toLocaleString("sv-SE", {
    minimumFractionDigits: hasOre || opts.alwaysDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} kr`;
}

/**
 * Kundpris från påslag: inköpspris × (1 + påslag %), avrundat till HELA
 * kronor (ören). Ett påslag på 0 % ger inköpspriset avrundat.
 */
export function customerPriceFromMarkupOre(unitCostOre: number, markupPercent: number): number {
  const kr = (unitCostOre / 100) * (1 + markupPercent / 100);
  return wholeKronorToOre(Math.round(kr));
}

/** Nettopris från listpris och rabatt i procent, i ören. */
export function netFromDiscountOre(listPriceOre: number, discountPercent: number): number {
  return Math.round(listPriceOre * (1 - discountPercent / 100));
}
